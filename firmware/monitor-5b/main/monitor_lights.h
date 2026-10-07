#pragma once
#include <stdbool.h>
#include <stddef.h>

void monitor_lights_init(void);
bool monitor_lights_command(const char *json);
bool monitor_lights_pop_reply(char *reply, size_t length);
void monitor_lights_diagnostics(char *json, size_t length);
