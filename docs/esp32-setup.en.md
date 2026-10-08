# ESP32 first-time installation

[中文](esp32-setup.md)

Flash Monitor firmware onto the screen first, then install the Windows Monitor ESP32 app. The EXE does not flash the board. Factory demo firmware cannot receive Monitor data. You only need to flash again when updating firmware.

## Hardware and downloads

This bundle targets **Waveshare ESP32-S3-Touch-LCD-5B, 1024×600, 16MB flash / 8MB PSRAM**. Other resolutions and boards require adaptation. Check your exact model in the [manufacturer documentation](https://docs.waveshare.com/ESP32-S3-Touch-LCD-5).

Download `Monitor-ESP32-VERSION-firmware-5B.zip` and `Monitor-ESP32-VERSION-Setup-x64.exe` from the [same Release](https://github.com/Fin2003/monitor-windows/releases/latest). Extract the firmware ZIP to a writable folder. Install [Python 3 for Windows](https://www.python.org/downloads/windows/) with PATH enabled. The script installs esptool in its local `.flash-tools` folder; no ESP-IDF or compilation is required.

## Flash the board

1. Close Monitor and serial terminal applications.
2. Connect a USB data cable. Use Device Manager → Ports and unplug/replug the screen to identify its COM port.
3. Run `flash-firmware.bat` and enter your screen's port. Check the model and port, then enter `FLASH`.
4. Wait for successful writes and `Hash of data verified`. Press RESET if the board does not restart.
5. Monitor uses the ESP32-S3 native **USB Serial/JTAG** channel at runtime. Follow your board's labels to distinguish its UART download port from its runtime USB connection.

The script writes bootloader at `0x0`, partition table at `0x8000`, and application at `0x10000`. It replaces the previous boot/display program without erasing the entire chip. Back up another firmware yourself before replacing it. No NVS dump or user configuration is included.

For a Monitor update with the same partition layout, use `flash-firmware.bat -AppOnly`; first-time installs should use the default full write. See [Espressif esptool documentation](https://docs.espressif.com/projects/esptool/en/latest/esp32s3/esptool/basic-commands.html) for manual flashing.

## Connect Windows

Install the ESP32 Setup EXE, start it, and choose Auto connect on the ESP32 screen page. Select a port manually if multiple devices exist. Configure your own accounts and sensors in the app. The board receives display data; it does not need your account keys.

Use the controls next to the preview title for dark/light mode and image backgrounds. Mouse clicks and drags simulate touch. Images remain in your Windows profile and are sent to board RAM on connection, at 512×300 RGB565 scaled to 1024×600. Reconnect after a board restart to restore the image. Firmware `monitor-native-0.16.0-background` and host 1.3.1 fix stale theme reports overwriting a new selection and move flash saves to an internal-RAM task. Background transfer waits for an acknowledgment for each block.

If no port appears, check the data cable and USB interface; hold BOOT while connecting and release it as described by Waveshare. For a stuck Connecting message, close serial apps, enter BOOT mode, retry, and press RESET afterwards. If the app is offline after flashing, confirm the native USB Serial/JTAG interface and close other Monitor instances.

## Prompt for AI-assisted setup

```text
Guide me through installing the ESP32 version of Fin2003/monitor-windows on Windows 10/11 x64.
Read https://github.com/Fin2003/monitor-windows/blob/esp32/docs/esp32-setup.en.md.
My board is Waveshare ESP32-S3-Touch-LCD-5B, 1024x600, 16MB flash / 8MB PSRAM.
Download firmware-5B.zip and the ESP32 Setup EXE from the same Release.
Identify MY screen's COM port by unplugging/replugging, then use flash-firmware.bat.
Do not assume a port, erase the entire chip, or touch other devices.
After flashing, install the EXE and connect USB Serial/JTAG. Check the physical screen, preview, themes and background.
I will configure accounts locally; do not ask me to send API keys or cookies in chat.
Wait for my result at each step and troubleshoot using the actual error message.
```
