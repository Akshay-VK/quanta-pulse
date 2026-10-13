// Prevents an additional console window on Windows in release. No-op on macOS.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    quanta_pulse_lib::run()
}
