# Optional ESP32 light control

The application shares its USB transport with the board BLE service. No personal lamp address, pairing token, captured command packet or external application profile is included.

Configure your own protocol identifiers in `.device-profile/lights-connection.json` for a source installation, or `%APPDATA%/monitor-esp32/lights-connection.json` for the installed EXE. This local file is ignored by Git. Its optional fields are `smartProAddress` (hex), `justGoGoToken` (hex) and `smartProPowerPackets` (a map of your own power command arrays). Leave a field absent to leave that light unconfigured. Existing protocol encoders and the firmware's lamp discovery are retained.

USB port detection selects a unique Espressif device; multiple candidates require selection in the manager. The device handshake confirms the board and display resolution before sending frames.

The local light API is `http://127.0.0.1:47833`. `GET /api/state` reads status, `POST /api/command` sends a command. The application does not import or sync state from other light applications.
