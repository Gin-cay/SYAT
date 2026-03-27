#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// ====== WiFi ======
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";

// ====== Backend ======
const char* ALARM_URL = "https://flask-vnaf-239145-8-1416119344.sh.run.tcloudbase.com/alarm";
const unsigned long POLL_INTERVAL_MS = 3000;
const unsigned long ALARM_DURATION_MS = 10000;

// ====== Pins ======
const int BUZZER_PIN = 13;
const int RELAY_PIN = 14;

unsigned long lastPollMs = 0;
bool alarming = false;
unsigned long alarmStartMs = 0;

void setOutputsOff() {
  digitalWrite(BUZZER_PIN, LOW);
  digitalWrite(RELAY_PIN, LOW);
}

void setOutputsOn() {
  digitalWrite(BUZZER_PIN, HIGH);
  digitalWrite(RELAY_PIN, HIGH);
}

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
  }
}

int fetchAlarmState() {
  if (WiFi.status() != WL_CONNECTED) return 0;

  HTTPClient http;
  http.begin(ALARM_URL);
  int status = http.GET();
  if (status < 200 || status >= 300) {
    http.end();
    return 0;
  }

  String body = http.getString();
  http.end();

  StaticJsonDocument<128> doc;
  DeserializationError err = deserializeJson(doc, body);
  if (err) return 0;
  return doc["alarm"] | 0;
}

void setup() {
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(RELAY_PIN, OUTPUT);
  setOutputsOff();  // 初始关闭蜂鸣器和喇叭继电器

  connectWiFi();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  unsigned long now = millis();

  if (!alarming && now - lastPollMs >= POLL_INTERVAL_MS) {
    lastPollMs = now;
    int alarm = fetchAlarmState();
    if (alarm == 1) {
      alarming = true;
      alarmStartMs = now;
      setOutputsOn();
    }
  }

  if (alarming && now - alarmStartMs >= ALARM_DURATION_MS) {
    alarming = false;
    setOutputsOff();
  }
}

