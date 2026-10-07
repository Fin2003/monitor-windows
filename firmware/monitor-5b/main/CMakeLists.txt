file(GLOB UI_FONT_SOURCES "fonts/*.c")
idf_component_register(
    SRCS
        "main.c"
        "monitor_lights.c"
        "monitor_capture.c"
        "monitor_input.c"
        "monitor_ui.c"
        "monitor_dashboard.c"
        "monitor_pages.c"
        "monitor_theme.c"
        "monitor_assets.c"
        ${UI_FONT_SOURCES}
        "monitor_settings.c"
        "../components/waveshare_rgb_lcd_port.c"
    INCLUDE_DIRS
        "."
        "../components"
    REQUIRES json esp_driver_usb_serial_jtag esp_timer nvs_flash mbedtls bt)

target_compile_definitions(${COMPONENT_LIB} PRIVATE LV_LVGL_H_INCLUDE_SIMPLE)

idf_build_get_property(build_components BUILD_COMPONENTS)
if("lvgl" IN_LIST build_components)
    idf_component_get_property(lvgl_lib lvgl COMPONENT_LIB)
elseif("lvgl__lvgl" IN_LIST build_components)
    idf_component_get_property(lvgl_lib lvgl__lvgl COMPONENT_LIB)
endif()

if(lvgl_lib)
    target_compile_options(${lvgl_lib} PRIVATE -Wno-format)
endif()
