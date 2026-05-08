"""
arduino_serial.py — Real Arduino Serial Reader

Reads live sensor data from a connected Arduino over a serial port
and yields readings in the same canonical format as the DataSimulator:

    T:28.5;TDS:320;TURB:2.1;LEVEL:380;LAT:12.971234;LON:77.594321;RGB:120,98,76

The Arduino sketch prints human-readable blocks like:

    ===== WATER QUALITY DATA =====
    Temperature: 28.50 °C
    TDS: 320 ppm
    Turbidity Voltage: 2.10
    Water Level: Low
    Latitude: 12.971234
    Longitude: 77.594321
    not available
    RGB: 120, 98, 76
    ==============================

This module buffers lines until a complete block is detected (delimited
by the ``=====`` markers), extracts values, and emits a single canonical
sensor string per block.
"""

from __future__ import annotations

import logging
import re
import time
from typing import Generator, Optional

logger = logging.getLogger(__name__)

try:
    import serial  # pyserial
    import serial.tools.list_ports
    _HAS_SERIAL = True
except ImportError:
    _HAS_SERIAL = False
    logger.warning(
        "pyserial not installed — ArduinoSerialReader will not work.  "
        "Install with:  pip install pyserial"
    )


# ── Water level: map the text labels back to approximate analog values ──
_LEVEL_TEXT_TO_VALUE = {
    "empty":  50,
    "low":    250,
    "medium": 425,
    "high":   500,
}


def list_serial_ports() -> list[str]:
    """Return a list of available serial port names (e.g. COM3, /dev/ttyUSB0)."""
    if not _HAS_SERIAL:
        return []
    return [p.device for p in serial.tools.list_ports.comports()]


class ArduinoSerialReader:
    """
    Connects to an Arduino over serial and yields sensor-data strings
    in the same format as ``DataSimulator.stream()``.

    Usage::

        reader = ArduinoSerialReader(port="COM3", baudrate=115200)
        for line in reader.stream():
            print(line)  # T:28.5;TDS:320;...
    """

    # Regex patterns used to extract values from the Arduino output
    _PATTERNS = {
        "temperature": re.compile(r"Temperature:\s*([\d.]+)", re.IGNORECASE),
        "tds":         re.compile(r"TDS:\s*([\d.]+)", re.IGNORECASE),
        "turbidity":   re.compile(r"Turbidity Voltage:\s*([\d.]+)", re.IGNORECASE),
        "level":       re.compile(r"Water Level:\s*(\w+)", re.IGNORECASE),
        "latitude":    re.compile(r"Latitude:\s*([\d.\-]+)", re.IGNORECASE),
        "longitude":   re.compile(r"Longitude:\s*([\d.\-]+)", re.IGNORECASE),
        "rgb":         re.compile(r"RGB:\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)", re.IGNORECASE),
    }

    _BLOCK_START = re.compile(r"=+ WATER QUALITY DATA =+")
    _BLOCK_END   = re.compile(r"={5,}")

    def __init__(
        self,
        port: str | None = None,
        baudrate: int = 115200,
        timeout: float = 2.0,
    ):
        """
        Args:
            port:     Serial port name (e.g. ``COM3``, ``/dev/ttyUSB0``).
                      If ``None``, auto-detects by trying every available port.
            baudrate: Must match the Arduino's ``Serial.begin()`` baud rate.
            timeout:  Read timeout in seconds.
        """
        if not _HAS_SERIAL:
            raise RuntimeError(
                "pyserial is not installed.  Run:  pip install pyserial"
            )

        self.port = port          # None = auto-detect
        self.baudrate = baudrate
        self.timeout = timeout
        self._ser: Optional[serial.Serial] = None

    # ── Connection management ─────────────────────────────────────────

    def _try_open_port(self, port: str) -> bool:
        """Attempt to open a single port. Returns True on success."""
        try:
            logger.info("Trying serial port %s @ %d baud …", port, self.baudrate)
            self._ser = serial.Serial(
                port=port,
                baudrate=self.baudrate,
                timeout=self.timeout,
            )
            # Give the Arduino a moment to reset after serial connect
            time.sleep(2.0)
            # Flush any startup junk
            self._ser.reset_input_buffer()
            self.port = port
            logger.info("Serial port %s opened successfully.", port)
            return True
        except (serial.SerialException, OSError) as exc:
            logger.warning("Could not open %s: %s", port, exc)
            self._ser = None
            return False

    def open(self) -> None:
        """
        Open the serial connection to the Arduino.

        If ``self.port`` is set, tries that port first.
        On failure (or if port is ``None``), iterates through all
        available serial ports until one connects.
        """
        if self._ser and self._ser.is_open:
            return

        # Build the list of ports to try
        all_ports = list_serial_ports()
        ports_to_try: list[str] = []

        if self.port:
            # User-specified port goes first, then the rest as fallback
            ports_to_try.append(self.port)
            ports_to_try.extend(p for p in all_ports if p != self.port)
        else:
            ports_to_try = all_ports

        if not ports_to_try:
            raise RuntimeError(
                "No serial ports found!  Connect the Arduino and retry."
            )

        logger.info("Available serial ports: %s", ports_to_try)

        for port in ports_to_try:
            if self._try_open_port(port):
                return

        # None worked
        raise RuntimeError(
            f"Could not open any serial port.  Tried: {ports_to_try}.  "
            "Make sure the Arduino is connected and no other program "
            "(e.g. Arduino IDE Serial Monitor) is using the port."
        )

    def close(self) -> None:
        """Close the serial connection."""
        if self._ser and self._ser.is_open:
            self._ser.close()
            logger.info("Serial port %s closed.", self.port)

    # ── Block parsing ─────────────────────────────────────────────────

    def _parse_block(self, lines: list[str]) -> Optional[str]:
        """
        Parse a list of lines from one ``===== WATER QUALITY DATA =====``
        block and return a canonical sensor string.

        Returns ``None`` if no usable data was found.
        """
        data: dict[str, str] = {}

        for line in lines:
            line = line.strip()
            if not line:
                continue

            # Temperature
            m = self._PATTERNS["temperature"].search(line)
            if m:
                data["T"] = m.group(1)
                continue

            # TDS
            m = self._PATTERNS["tds"].search(line)
            if m:
                data["TDS"] = m.group(1)
                continue

            # Turbidity (voltage → approximate NTU conversion)
            m = self._PATTERNS["turbidity"].search(line)
            if m:
                voltage = float(m.group(1))
                # Simple linear mapping: clean water ≈ 4.1 V → 0 NTU,
                # very turbid ≈ 2.5 V → 4000 NTU.  Capped at [0, 4000].
                if voltage >= 4.1:
                    ntu = 0.0
                elif voltage >= 2.5:
                    ntu = (4.1 - voltage) / (4.1 - 2.5) * 4000.0
                else:
                    ntu = 4000.0
                data["TURB"] = f"{ntu:.1f}"
                continue

            # Water Level (text label → numeric)
            m = self._PATTERNS["level"].search(line)
            if m:
                label = m.group(1).lower()
                numeric = _LEVEL_TEXT_TO_VALUE.get(label, 0)
                data["LEVEL"] = str(numeric)
                continue

            # Latitude
            m = self._PATTERNS["latitude"].search(line)
            if m:
                data["LAT"] = m.group(1)
                continue

            # Longitude
            m = self._PATTERNS["longitude"].search(line)
            if m:
                data["LON"] = m.group(1)
                continue

            # RGB
            m = self._PATTERNS["rgb"].search(line)
            if m:
                data["RGB"] = f"{m.group(1)},{m.group(2)},{m.group(3)}"
                continue

        if not data:
            return None

        # ── Default GPS: RV College of Engineering, DJ Hostel ─────────
        # If the Arduino's GPS module didn't get a fix, use this fallback.
        if "LAT" not in data:
            data["LAT"] = "12.923750"
        if "LON" not in data:
            data["LON"] = "77.498700"

        # Build canonical string in the expected order
        parts: list[str] = []
        for key in ("T", "TDS", "TURB", "LEVEL", "LAT", "LON", "RGB"):
            if key in data:
                parts.append(f"{key}:{data[key]}")

        return ";".join(parts) if parts else None

    # ── Streaming API (same interface as DataSimulator.stream()) ──────

    def stream(self, interval: float = 0.0, count: int | None = None) -> Generator[str, None, None]:
        """
        Yield canonical sensor strings as complete data blocks arrive.

        Args:
            interval: Ignored (kept for API compatibility); the Arduino
                      controls the cadence (~2 s per block).
            count:    Stop after this many readings; ``None`` = infinite.

        Yields:
            Sensor string, e.g.
            ``T:28.5;TDS:320;TURB:2.1;LEVEL:250;LAT:12.971234;LON:77.594321;RGB:120,98,76``
        """
        self.open()
        produced = 0
        in_block = False
        block_lines: list[str] = []

        try:
            while count is None or produced < count:
                raw = self._ser.readline()
                if not raw:
                    continue

                try:
                    line = raw.decode("utf-8", errors="replace").strip()
                except UnicodeDecodeError:
                    continue

                if not line:
                    continue

                # Detect block boundaries
                if self._BLOCK_START.search(line):
                    in_block = True
                    block_lines = []
                    continue

                if in_block and self._BLOCK_END.search(line):
                    # End of block — parse and yield
                    result = self._parse_block(block_lines)
                    if result:
                        produced += 1
                        logger.debug("Arduino block #%d: %s", produced, result)
                        yield result
                    else:
                        logger.warning("Arduino block contained no usable data.")
                    in_block = False
                    block_lines = []
                    continue

                if in_block:
                    block_lines.append(line)

        except KeyboardInterrupt:
            logger.info("Serial stream interrupted by user.")
        except serial.SerialException as exc:
            logger.error("Serial error: %s", exc)
        finally:
            self.close()

    # ── Convenience: generate a single reading ────────────────────────

    def generate_reading(self) -> Optional[str]:
        """
        Read a single complete data block from the Arduino.
        Returns ``None`` on timeout or error.
        """
        for line in self.stream(count=1):
            return line
        return None


# ── Standalone demo ───────────────────────────────────────────────────
if __name__ == "__main__":
    import sys

    logging.basicConfig(level=logging.DEBUG, format="%(asctime)s [%(levelname)s] %(message)s")

    ports = list_serial_ports()
    print(f"Available serial ports: {ports}")

    port = sys.argv[1] if len(sys.argv) > 1 else (ports[0] if ports else "COM3")
    baud = int(sys.argv[2]) if len(sys.argv) > 2 else 115200

    print(f"\nConnecting to {port} @ {baud} baud …")
    print("Press Ctrl+C to stop.\n")

    reader = ArduinoSerialReader(port=port, baudrate=baud)
    try:
        for canonical in reader.stream():
            print(f"  → {canonical}")
    except KeyboardInterrupt:
        print("\nStopped.")
