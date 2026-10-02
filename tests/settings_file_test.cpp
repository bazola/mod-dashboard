// Pure config writer test: compile with src/mod_dashboard_settings.cpp, no realm required.
#include "mod_dashboard_settings.h"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <iterator>
#include <stdexcept>

namespace fs = std::filesystem;

std::string Read(fs::path const& path)
{
    std::ifstream in(path, std::ios::binary);
    return { std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>() };
}

void Check(bool condition, char const* message)
{
    if (!condition)
        throw std::runtime_error(message);
}

int main()
{
    auto directory = fs::temp_directory_path() /
        ("dashboard-settings-" + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
    fs::create_directory(directory);
    int result = 0;
    try
    {
        auto file = directory / "module.conf";
        std::string const original = "\xEF\xBB\xBF# Key = 0\r\nKey = 0\r\nKey.Other = 9\r\n Key = 2\r\n";
        { std::ofstream out(file, std::ios::binary); out << original; }
        Check(DashboardSettings::Write(file, "Key", "1").empty(), "write failed");
        Check(Read(file) == "\xEF\xBB\xBF# Key = 0\r\nKey = 1\r\nKey.Other = 9\r\nKey = 1\r\n",
              "duplicates, comments, BOM or newline handling failed");
        Check(Read(file.string() + ".dashboard.bak") == original, "backup does not match original");
        Check(DashboardSettings::Write(file, "Model", "").empty(), "empty value failed");
        Check(Read(file).find("Model = \"\"\r\n") != std::string::npos, "empty value not quoted");
        Check(DashboardSettings::Write(file, "Prompt", "two words").empty(), "quoted value failed");
        Check(Read(file).find("Prompt = \"two words\"\r\n") != std::string::npos, "spaces not quoted");
        auto unchanged = Read(file);
        for (auto const* key : { "Dashboard.CommandToken", "dashboard.Settings.chat.File", "Some.TOKEN", "Some.Password",
                                "Some.secret", "Provider.ApiKey", "Bad Key" })
        {
            Check(!DashboardSettings::AllowedKey(key), "unsafe key allowlisted");
            Check(!DashboardSettings::Write(file, key, "1").empty(), "unsafe key written");
        }
        Check(DashboardSettings::AllowedKey("OllamaChat.Reply.NumPredict"), "safe key rejected");
        DashboardSettings::Rule rule;
        Check(DashboardSettings::ParseRule("int:0:2", rule), "integer range failed");
        for (auto const* raw : { "abc", "-1", "3", "1.5", "1e0", "9223372036854775808", "" })
        {
            std::string value = raw;
            Check(!DashboardSettings::Validate(rule, value).empty(), "invalid mode accepted");
        }
        std::string value = " 2 ";
        Check(DashboardSettings::Validate(rule, value).empty() && value == "2", "valid mode normalization failed");
        Check(DashboardSettings::ParseRule("bool", rule), "boolean type failed");
        value = " TRUE ";
        Check(DashboardSettings::Validate(rule, value).empty() && value == "1", "boolean normalization failed");
        value = "2";
        Check(!DashboardSettings::Validate(rule, value).empty(), "invalid boolean accepted");
        Check(DashboardSettings::ParseRule("number:5:100", rule), "number type failed");
        value = "12.5";
        Check(DashboardSettings::Validate(rule, value).empty(), "decimal distance rejected");
        for (auto const* raw : { "NaN", "inf", "101", "4.99", "0x20" })
        {
            value = raw;
            Check(!DashboardSettings::Validate(rule, value).empty(), "invalid number accepted");
        }
        for (auto const* spec : { "bool:0:1", "text:0", "number:NaN:100", "int:0:1.5", "int:3:2", "int:0:9007199254740992", "unknown", "int:0:2:3" })
            Check(!DashboardSettings::ParseRule(spec, rule), "invalid rule accepted");
        Check(DashboardSettings::InferRule("1").kind == DashboardSettings::Kind::Int, "ambiguous numeric mode inferred as boolean");
        Check(DashboardSettings::InferRule("true").kind == DashboardSettings::Kind::Bool, "boolean inference failed");
        Check(DashboardSettings::InferRule("12.5").kind == DashboardSettings::Kind::Number, "numeric inference failed");
        Check(DashboardSettings::InferRule("model-name").kind == DashboardSettings::Kind::Text, "text inference failed");
        value = "abc";
        Check(!DashboardSettings::Validate(DashboardSettings::InferRule("1"), value).empty(), "numeric fallback accepts text");
        value = "9007199254740992";
        Check(!DashboardSettings::Validate(DashboardSettings::InferRule("1"), value).empty(), "inexact integer accepted");
        for (auto const& unsafe : { std::string("a\nb"), std::string("a\0b", 3), std::string("\"bad\""), std::string(2001, 'x') })
            Check(!DashboardSettings::Write(file, "Key", unsafe).empty(), "unsafe value accepted");
        Check(!DashboardSettings::Write(file, "Key\nInjected", "1").empty(), "unsafe key accepted");
        Check(Read(file) == unchanged, "invalid input modified file");
        fs::remove(file.string() + ".dashboard.bak");
        fs::create_directory(file.string() + ".dashboard.bak");
        Check(!DashboardSettings::Write(file, "Key", "0").empty(), "backup failure ignored");
        Check(Read(file) == unchanged, "backup failure modified file");
        Check(!DashboardSettings::Write(directory / "missing.conf", "Key", "1").empty(), "missing file accepted");
        std::cout << "PASS settings file writes, duplicate keys, backups, unsafe input and failure safety\n";
    }
    catch (std::exception const& error)
    {
        std::cerr << error.what() << '\n';
        result = 1;
    }
    fs::remove_all(directory);
    return result;
}
