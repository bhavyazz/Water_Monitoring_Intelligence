"""
Simulator package — emulates Arduino + sensor hardware.
Generates realistic water quality sensor data.
Also provides ArduinoSerialReader for live hardware connections.
"""
from .data_simulator import DataSimulator
from .arduino_serial import ArduinoSerialReader, list_serial_ports
