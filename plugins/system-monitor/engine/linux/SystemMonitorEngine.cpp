#include <hwinfo/cpu.h>
#include <hwinfo/disk.h>
#include <hwinfo/gpu.h>
#include <hwinfo/monitoring/cpu.h>
#include <hwinfo/monitoring/disk.h>
#include <hwinfo/monitoring/ram.h>
#include <hwinfo/ram.h>

#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/select.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <unistd.h>
#include <signal.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <cerrno>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <exception>
#include <iomanip>
#include <iostream>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <sstream>
#include <string>
#include <thread>
#include <utility>
#include <vector>

namespace {

using namespace std::chrono_literals;

struct SensorRecord {
  std::string id;
  std::string name;
  std::string type;
  std::string unit;
  double value = 0;
  double minimum = 0;
  double maximum = 0;
  bool available = false;
};

struct HardwareRecord {
  std::string id;
  std::string name;
  std::vector<std::string> sensor_ids;
};

std::string json_escape(const std::string& value) {
  std::ostringstream output;
  output << '"';
  for (unsigned char character : value) {
    switch (character) {
      case '"': output << "\\\""; break;
      case '\\': output << "\\\\"; break;
      case '\b': output << "\\b"; break;
      case '\f': output << "\\f"; break;
      case '\n': output << "\\n"; break;
      case '\r': output << "\\r"; break;
      case '\t': output << "\\t"; break;
      default:
        if (character < 0x20) {
          output << "\\u" << std::hex << std::setw(4) << std::setfill('0')
                 << static_cast<int>(character) << std::dec << std::setfill(' ');
        } else {
          output << character;
        }
        break;
    }
  }
  output << '"';
  return output.str();
}

std::string number(double value) {
  if (!std::isfinite(value)) return "null";
  std::ostringstream output;
  output << std::setprecision(12) << value;
  return output.str();
}

std::string formatted_value(const SensorRecord& sensor) {
  std::ostringstream output;
  if (sensor.type == "Clock") {
    output << std::fixed << std::setprecision(0);
  } else if (sensor.type == "Data") {
    output << std::fixed << std::setprecision(2);
  } else {
    output << std::fixed << std::setprecision(1);
  }
  output << sensor.value;
  if (!sensor.unit.empty()) output << ' ' << sensor.unit;
  return output.str();
}

std::string hostname() {
  char buffer[256]{};
  if (gethostname(buffer, sizeof(buffer) - 1) == 0 && buffer[0] != '\0') return buffer;
  return "Linux";
}

std::optional<int> parse_int(const char* value) {
  if (!value) return std::nullopt;
  char* end = nullptr;
  long parsed = std::strtol(value, &end, 10);
  if (end == value || *end != '\0' || parsed < 0 || parsed > 65535) return std::nullopt;
  return static_cast<int>(parsed);
}

class Engine {
 public:
  Engine(int port, int parent_pid) : port_(port), parent_pid_(parent_pid) {}

  ~Engine() {
    stop();
    if (initialization_thread_.joinable()) initialization_thread_.join();
    if (poll_thread_.joinable()) poll_thread_.join();
    if (parent_thread_.joinable()) parent_thread_.join();
  }

  int run() {
    listen_socket_ = socket(AF_INET, SOCK_STREAM, 0);
    if (listen_socket_ < 0) {
      std::cerr << "socket failed: " << std::strerror(errno) << '\n';
      return 1;
    }

    int reuse = 1;
    setsockopt(listen_socket_, SOL_SOCKET, SO_REUSEADDR, &reuse, sizeof(reuse));
    sockaddr_in address{};
    address.sin_family = AF_INET;
    address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    address.sin_port = htons(static_cast<uint16_t>(port_));
    if (bind(listen_socket_, reinterpret_cast<sockaddr*>(&address), sizeof(address)) < 0 ||
        listen(listen_socket_, 16) < 0) {
      std::cerr << "listen failed: " << std::strerror(errno) << '\n';
      close(listen_socket_);
      listen_socket_ = -1;
      return 1;
    }

    std::cout << "READY\n" << std::flush;
    initialization_thread_ = std::thread([this]() { initialize(); });
    if (parent_pid_ > 0) {
      parent_thread_ = std::thread([this]() {
        while (!stopping_) {
          if (kill(parent_pid_, 0) != 0 && errno == ESRCH) {
            stop();
            break;
          }
          std::this_thread::sleep_for(2s);
        }
      });
    }

    while (!stopping_) {
      fd_set read_set;
      FD_ZERO(&read_set);
      FD_SET(listen_socket_, &read_set);
      timeval timeout{1, 0};
      int result = select(listen_socket_ + 1, &read_set, nullptr, nullptr, &timeout);
      if (result <= 0) continue;
      int client = accept(listen_socket_, nullptr, nullptr);
      if (client >= 0) std::thread(&Engine::handle_client, this, client).detach();
    }
    return 0;
  }

 private:
  void initialize() {
    try {
      auto cpus = hwinfo::getAllCPUs();
      auto gpus = hwinfo::getAllGPUs();
      auto disks = hwinfo::getAllDisks();
      auto memory = std::make_unique<hwinfo::Memory>();
      {
        std::lock_guard<std::mutex> lock(mutex_);
        cpus_ = std::move(cpus);
        gpus_ = std::move(gpus);
        disks_ = std::move(disks);
        memory_ = std::move(memory);
        build_hardware_locked();
      }
      update_snapshot();
      {
        std::lock_guard<std::mutex> lock(mutex_);
        initialized_ = true;
      }
      poll_thread_ = std::thread([this]() { poll_loop(); });
    } catch (const std::exception& error) {
      std::lock_guard<std::mutex> lock(mutex_);
      initialization_error_ = error.what();
    } catch (...) {
      std::lock_guard<std::mutex> lock(mutex_);
      initialization_error_ = "unknown initialization error";
    }
  }

  void build_hardware_locked() {
    hardware_.clear();
    sensors_.clear();
    for (std::size_t index = 0; index < cpus_.size(); ++index) {
      HardwareRecord hardware{ "/hwinfo/cpu/" + std::to_string(index), "CPU " + std::to_string(index + 1), {} };
      add_sensor_locked(hardware, "load", "CPU Total Load", "Load", "%", 0, false);
      const auto logical_count = static_cast<std::size_t>(cpus_[index].numLogicalCores());
      for (std::size_t thread = 0; thread < logical_count; ++thread) {
        add_sensor_locked(hardware, "thread/" + std::to_string(thread) + "/load",
                          "CPU Thread #" + std::to_string(thread + 1) + " Load", "Load", "%", 0, false);
        add_sensor_locked(hardware, "thread/" + std::to_string(thread) + "/frequency",
                          "CPU Thread #" + std::to_string(thread + 1) + " Frequency", "Clock", "MHz", 0, false);
      }
      hardware_.push_back(std::move(hardware));
    }

    if (memory_) {
      HardwareRecord hardware{ "/hwinfo/ram", "Memory", {} };
      add_sensor_locked(hardware, "total", "Total Memory", "Data", "GiB",
                        static_cast<double>(memory_->size()) / (1024.0 * 1024.0 * 1024.0), true);
      add_sensor_locked(hardware, "free", "Free Memory", "Data", "GiB", 0, false);
      add_sensor_locked(hardware, "available", "Available Memory", "Data", "GiB", 0, false);
      hardware_.push_back(std::move(hardware));
    }

    for (std::size_t index = 0; index < gpus_.size(); ++index) {
      const auto& gpu = gpus_[index];
      HardwareRecord hardware{ "/hwinfo/gpu/" + std::to_string(index), gpu.name(), {} };
      add_sensor_locked(hardware, "dedicated-memory", "Dedicated Memory", "Data", "GiB",
                        static_cast<double>(gpu.dedicated_memory_Bytes()) / (1024.0 * 1024.0 * 1024.0), true);
      add_sensor_locked(hardware, "shared-memory", "Shared Memory", "Data", "GiB",
                        static_cast<double>(gpu.shared_memory_Bytes()) / (1024.0 * 1024.0 * 1024.0), true);
      add_sensor_locked(hardware, "frequency", "GPU Frequency", "Clock", "MHz",
                        static_cast<double>(gpu.frequency_hz()) / 1000000.0, gpu.frequency_hz() > 0);
      hardware_.push_back(std::move(hardware));
    }

    for (std::size_t index = 0; index < disks_.size(); ++index) {
      const auto& disk = disks_[index];
      HardwareRecord hardware{ "/hwinfo/disk/" + std::to_string(index), disk.model(), {} };
      add_sensor_locked(hardware, "size", "Disk Size", "Data", "GiB",
                        static_cast<double>(disk.size()) / (1024.0 * 1024.0 * 1024.0), true);
      const auto& mounts = disk.mount_points();
      for (std::size_t mount = 0; mount < mounts.size(); ++mount) {
        add_sensor_locked(hardware, "mount/" + std::to_string(mount) + "/free",
                          "Free " + mounts[mount], "Data", "GiB", 0, false);
      }
      hardware_.push_back(std::move(hardware));
    }
  }

  void add_sensor_locked(HardwareRecord& hardware, const std::string& suffix, const std::string& name,
                         const std::string& type, const std::string& unit, double value, bool available) {
    const std::string id = hardware.id + "/" + suffix;
    hardware.sensor_ids.push_back(id);
    sensors_[id] = SensorRecord{ id, name, type, unit, value, value, value, available };
  }

  void update_snapshot() {
    std::lock_guard<std::mutex> lock(mutex_);
    if (cpus_.empty()) return;
    const auto cpu_data = hwinfo::monitoring::cpu::fetch(100ms);
    update_sensor_locked("/hwinfo/cpu/0/load", cpu_data.utilization * 100.0);
    for (std::size_t index = 0; index < cpu_data.thread_utilization.size(); ++index) {
      update_sensor_locked("/hwinfo/cpu/0/thread/" + std::to_string(index) + "/load",
                           cpu_data.thread_utilization[index] * 100.0);
    }
    for (std::size_t index = 0; index < cpu_data.thread_frequency_hz.size(); ++index) {
      update_sensor_locked("/hwinfo/cpu/0/thread/" + std::to_string(index) + "/frequency",
                           static_cast<double>(cpu_data.thread_frequency_hz[index]) / 1000000.0);
    }

    if (memory_) {
      const auto ram = hwinfo::monitoring::ram::fetch();
      update_sensor_locked("/hwinfo/ram/free", static_cast<double>(ram.free_bytes) / (1024.0 * 1024.0 * 1024.0));
      update_sensor_locked("/hwinfo/ram/available", static_cast<double>(ram.available_bytes) / (1024.0 * 1024.0 * 1024.0));
    }

    for (std::size_t index = 0; index < disks_.size(); ++index) {
      const auto& mounts = disks_[index].mount_points();
      for (std::size_t mount = 0; mount < mounts.size(); ++mount) {
        const auto free_bytes = hwinfo::monitoring::disk::get_free_size(mounts[mount]);
        update_sensor_locked("/hwinfo/disk/" + std::to_string(index) + "/mount/" + std::to_string(mount) + "/free",
                             static_cast<double>(free_bytes) / (1024.0 * 1024.0 * 1024.0));
      }
    }
  }

  void update_sensor_locked(const std::string& id, double value) {
    auto sensor = sensors_.find(id);
    if (sensor == sensors_.end() || !std::isfinite(value)) return;
    sensor->second.value = value;
    if (!sensor->second.available) {
      sensor->second.minimum = value;
      sensor->second.maximum = value;
    } else {
      sensor->second.minimum = std::min(sensor->second.minimum, value);
      sensor->second.maximum = std::max(sensor->second.maximum, value);
    }
    sensor->second.available = true;
  }

  void poll_loop() {
    while (!stopping_) {
      try { update_snapshot(); } catch (...) {}
      std::unique_lock<std::mutex> lock(wait_mutex_);
      wait_condition_.wait_for(lock, 1s, [this]() { return stopping_.load(); });
    }
  }

  void handle_client(int client) {
    char buffer[8192]{};
    const ssize_t length = recv(client, buffer, sizeof(buffer) - 1, 0);
    if (length <= 0) {
      close(client);
      return;
    }
    std::string request(buffer, static_cast<std::size_t>(length));
    const auto line_end = request.find("\r\n");
    const std::string request_line = request.substr(0, line_end);
    const auto path_start = request_line.find(' ');
    const auto path_end = path_start == std::string::npos ? std::string::npos : request_line.find(' ', path_start + 1);
    const std::string target = path_start == std::string::npos ? "/" : request_line.substr(path_start + 1, path_end - path_start - 1);
    const auto query_start = target.find('?');
    const std::string route = target.substr(0, query_start);
    const std::string query = query_start == std::string::npos ? "" : target.substr(query_start + 1);

    int status = 200;
    std::string content_type = "application/json; charset=utf-8";
    std::string body;
    if (route == "/health") {
      std::lock_guard<std::mutex> lock(mutex_);
      status = initialized_ ? 200 : 503;
      body = diagnostics_locked();
    } else if (route == "/data.json") {
      std::lock_guard<std::mutex> lock(mutex_);
      if (!initialized_) {
        status = 503;
        body = diagnostics_locked();
      } else {
        body = tree_locked();
      }
    } else if (route == "/metrics") {
      std::lock_guard<std::mutex> lock(mutex_);
      if (!initialized_) {
        status = 503;
        body = diagnostics_locked();
      } else {
        content_type = "text/plain; version=0.0.4";
        body = metrics_locked();
      }
    } else if (route == "/sensor") {
      const std::string id = query_value(query, "id");
      const std::string action = query_value(query, "action");
      std::lock_guard<std::mutex> lock(mutex_);
      if (!initialized_) {
        status = 503;
        body = diagnostics_locked();
      } else if (action == "Get") {
        body = sensor_result_locked(id);
        if (body.empty()) { status = 404; body = error_json("Unknown sensor id"); }
      } else if (action == "ResetMinMax") {
        auto sensor = sensors_.find(id);
        if (sensor == sensors_.end()) { status = 404; body = error_json("Unknown sensor id"); }
        else {
          sensor->second.minimum = sensor->second.value;
          sensor->second.maximum = sensor->second.value;
          body = sensor_result_locked(id);
        }
      } else {
        status = 400;
        body = error_json("Linux hwinfo backend is read-only");
      }
    } else if (route == "/resetallminmax") {
      std::lock_guard<std::mutex> lock(mutex_);
      for (auto& item : sensors_) {
        item.second.minimum = item.second.value;
        item.second.maximum = item.second.value;
      }
      body = initialized_ ? tree_locked() : diagnostics_locked();
      if (!initialized_) status = 503;
    } else if (route == "/shutdown") {
      body = "{\"result\":\"ok\"}";
      stop();
    } else {
      status = 404;
      body = error_json("Not found");
    }
    send_response(client, status, content_type, body);
    close(client);
  }

  std::string query_value(const std::string& query, const std::string& key) const {
    std::size_t start = 0;
    while (start < query.size()) {
      const std::size_t end = query.find('&', start);
      const std::string item = query.substr(start, end == std::string::npos ? std::string::npos : end - start);
      const std::size_t equal = item.find('=');
      if (equal != std::string::npos && item.substr(0, equal) == key) return item.substr(equal + 1);
      if (end == std::string::npos) break;
      start = end + 1;
    }
    return {};
  }

  std::string diagnostics_locked() const {
    std::ostringstream output;
    output << "{\"status\":" << json_escape(initialized_ ? "ok" : initialization_error_.empty() ? "starting" : "error")
           << ",\"error\":" << json_escape(initialization_error_)
           << ",\"backend\":\"hwinfo\",\"platform\":\"linux\",\"version\":\"1.0.0\","
           << "\"isAdministrator\":false,\"requiresAdministrator\":false,"
           << "\"readOnly\":true,\"experimentalDriverConfigured\":false,\"experimentalDriverActive\":false,"
           << "\"experimentalDriverRebootRequired\":false,\"experimentalDriverMessage\":\"Linux hwinfo 后端不需要 PawnIO\","
           << "\"capabilities\":{\"temperature\":false,\"fan\":false,\"power\":false,\"gpuHotspot\":false,\"control\":false},"
           << "\"source\":{\"name\":\"lfreist/hwinfo\",\"url\":\"https://github.com/lfreist/hwinfo\",\"license\":\"MIT\"}"
           << "}";
    return output.str();
  }

  std::string tree_locked() const {
    std::ostringstream output;
    int node_id = 1;
    output << "{\"id\":0,\"Version\":\"hwinfo-1.0.0\",\"Text\":\"Sensor\",\"Min\":\"Min\",\"Value\":\"Value\",\"Max\":\"Max\",\"ImageURL\":\"\",\"Diagnostics\":"
           << diagnostics_locked() << ",\"Children\":[{\"id\":" << node_id++ << ",\"Text\":" << json_escape(hostname())
           << ",\"Min\":\"\",\"Value\":\"\",\"Max\":\"\",\"Children\":[";
    for (std::size_t index = 0; index < hardware_.size(); ++index) {
      if (index) output << ',';
      const auto& hardware = hardware_[index];
      output << "{\"id\":" << node_id++ << ",\"Text\":" << json_escape(hardware.name)
             << ",\"HardwareId\":" << json_escape(hardware.id) << ",\"Min\":\"\",\"Value\":\"\",\"Max\":\"\",\"Children\":[";
      for (std::size_t sensor_index = 0; sensor_index < hardware.sensor_ids.size(); ++sensor_index) {
        if (sensor_index) output << ',';
        const auto& sensor = sensors_.at(hardware.sensor_ids[sensor_index]);
        output << "{\"id\":" << node_id++ << ",\"Text\":" << json_escape(sensor.name)
               << ",\"SensorId\":" << json_escape(sensor.id) << ",\"Type\":" << json_escape(sensor.type)
               << ",\"Min\":" << json_escape(sensor.available ? formatted_value(SensorRecord{sensor.id, sensor.name, sensor.type, sensor.unit, sensor.minimum, sensor.minimum, sensor.maximum, true}) : "")
               << ",\"Value\":" << json_escape(sensor.available ? formatted_value(sensor) : "")
               << ",\"Max\":" << json_escape(sensor.available ? formatted_value(SensorRecord{sensor.id, sensor.name, sensor.type, sensor.unit, sensor.maximum, sensor.minimum, sensor.maximum, true}) : "")
               << ",\"RawMin\":" << (sensor.available ? number(sensor.minimum) : "null")
               << ",\"RawValue\":" << (sensor.available ? number(sensor.value) : "null")
               << ",\"RawMax\":" << (sensor.available ? number(sensor.maximum) : "null")
               << ",\"Children\":[]}";
      }
      output << "]}";
    }
    output << "]}]}";
    return output.str();
  }

  std::string sensor_result_locked(const std::string& id) const {
    const auto sensor = sensors_.find(id);
    if (sensor == sensors_.end()) return {};
    std::ostringstream output;
    output << "{\"result\":\"ok\",\"value\":" << (sensor->second.available ? number(sensor->second.value) : "null")
           << ",\"min\":" << (sensor->second.available ? number(sensor->second.minimum) : "null")
           << ",\"max\":" << (sensor->second.available ? number(sensor->second.maximum) : "null")
           << ",\"format\":" << json_escape("{0:F1} " + sensor->second.unit) << "}";
    return output.str();
  }

  std::string metrics_locked() const {
    std::ostringstream output;
    for (const auto& item : sensors_) {
      if (!item.second.available) continue;
      std::string name = "hwinfo_" + item.second.type + "_" + item.second.name;
      std::replace(name.begin(), name.end(), ' ', '_');
      output << name << "{sensor_id=" << json_escape(item.second.id) << "} " << number(item.second.value) << '\n';
    }
    return output.str();
  }

  std::string error_json(const std::string& message) const {
    return "{\"result\":\"fail\",\"message\":" + json_escape(message) + "}";
  }

  void send_response(int client, int status, const std::string& content_type, const std::string& body) const {
    const char* reason = status == 200 ? "OK" : status == 400 ? "Bad Request" : status == 404 ? "Not Found" : "Service Unavailable";
    std::ostringstream response;
    response << "HTTP/1.1 " << status << ' ' << reason << "\r\nContent-Type: " << content_type
             << "\r\nCache-Control: no-cache\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: "
             << body.size() << "\r\nConnection: close\r\n\r\n" << body;
    const std::string value = response.str();
    send(client, value.data(), value.size(), MSG_NOSIGNAL);
  }

  void stop() {
    const bool was_stopping = stopping_.exchange(true);
    wait_condition_.notify_all();
    if (!was_stopping && listen_socket_ >= 0) {
      shutdown(listen_socket_, SHUT_RDWR);
      close(listen_socket_);
      listen_socket_ = -1;
    }
  }

  int port_;
  int parent_pid_;
  int listen_socket_ = -1;
  std::atomic<bool> stopping_{false};
  std::atomic<bool> initialized_{false};
  mutable std::mutex mutex_;
  std::mutex wait_mutex_;
  std::condition_variable wait_condition_;
  std::thread initialization_thread_;
  std::thread poll_thread_;
  std::thread parent_thread_;
  std::string initialization_error_;
  std::vector<hwinfo::CPU> cpus_;
  std::vector<hwinfo::GPU> gpus_;
  std::vector<hwinfo::Disk> disks_;
  std::unique_ptr<hwinfo::Memory> memory_;
  std::vector<HardwareRecord> hardware_;
  std::map<std::string, SensorRecord> sensors_;
};

}

int main(int argc, char** argv) {
  int port = 0;
  int parent_pid = 0;
  for (int index = 1; index + 1 < argc; ++index) {
    if (std::string(argv[index]) == "--port") port = parse_int(argv[index + 1]).value_or(0);
    if (std::string(argv[index]) == "--parent-pid") parent_pid = parse_int(argv[index + 1]).value_or(0);
  }
  if (port < 1024 || port > 65535) {
    std::cerr << "A valid --port is required.\n";
    return 2;
  }
  Engine engine(port, parent_pid);
  return engine.run();
}
