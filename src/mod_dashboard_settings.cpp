#include "mod_dashboard_settings.h"

#include <algorithm>
#include <cctype>
#include <charconv>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <iterator>
#include <sstream>
#include <system_error>
#include <vector>

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#endif

namespace DashboardSettings
{
    constexpr size_t MAX_CONFIG_BYTES = 1024 * 1024;

    namespace
    {
        std::string Lower(std::string text)
        {
            std::transform(text.begin(), text.end(), text.begin(),
                           [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
            return text;
        }

        std::string Trim(std::string const& text)
        {
            auto first = text.find_first_not_of(" ");
            return first == std::string::npos ? "" : text.substr(first, text.find_last_not_of(" ") - first + 1);
        }

        bool Number(std::string const& text, double& number)
        {
            if (text.empty())
                return false;
            auto result = std::from_chars(text.data(), text.data() + text.size(), number);
            return result.ec == std::errc() && result.ptr == text.data() + text.size() && std::isfinite(number);
        }

        bool Integer(std::string const& text)
        {
            if (text.empty())
                return false;
            int64_t number;
            auto result = std::from_chars(text.data(), text.data() + text.size(), number);
            return result.ec == std::errc() && result.ptr == text.data() + text.size();
        }
    }

    bool AllowedKey(std::string const& key)
    {
        if (key.empty() || key.size() > 200 || !std::all_of(key.begin(), key.end(), [](unsigned char c)
            { return std::isalnum(c) || c == '.' || c == '_' || c == '-'; }))
            return false;
        auto lower = Lower(key);
        if (lower.rfind("dashboard.", 0) == 0)
            return false;
        for (auto const* secret : { "token", "password", "secret", "apikey" })
            if (lower.find(secret) != std::string::npos)
                return false;
        return true;
    }

    char const* KindName(Kind kind)
    {
        switch (kind)
        {
            case Kind::Bool: return "bool";
            case Kind::Int: return "int";
            case Kind::Number: return "number";
            default: return "text";
        }
    }

    bool ParseRule(std::string const& spec, Rule& rule)
    {
        std::vector<std::string> parts;
        for (size_t start = 0; ; )
        {
            auto end = spec.find(':', start);
            parts.push_back(Trim(spec.substr(start, end == std::string::npos ? end : end - start)));
            if (end == std::string::npos)
                break;
            start = end + 1;
        }
        Rule parsed;
        if (parts[0] == "bool") parsed.kind = Kind::Bool;
        else if (parts[0] == "int") parsed.kind = Kind::Int;
        else if (parts[0] == "number") parsed.kind = Kind::Number;
        else if (parts[0] != "text") return false;
        if (parts.size() > 3 || (parts.size() > 1 && (parsed.kind == Kind::Bool || parsed.kind == Kind::Text)))
            return false;
        for (size_t i = 1; i < parts.size(); ++i)
        {
            if (parts[i].empty())
                continue;
            double bound;
            if (!Number(parts[i], bound) || (parsed.kind == Kind::Int && (!Integer(parts[i]) || std::abs(bound) > 9007199254740991.0)))
                return false;
            (i == 1 ? parsed.min : parsed.max) = bound;
        }
        if (parsed.min && parsed.max && *parsed.min > *parsed.max)
            return false;
        rule = parsed;
        return true;
    }

    Rule InferRule(std::string const& active)
    {
        auto value = Trim(active);
        auto lower = Lower(value);
        if (lower == "true" || lower == "false" || lower == "on" || lower == "off")
            return { Kind::Bool, {}, {} };
        if (Integer(value))
            return { Kind::Int, {}, {} };
        double number;
        if (Number(value, number))
            return { Kind::Number, {}, {} };
        return {};
    }

    std::string Validate(Rule const& rule, std::string& value)
    {
        if (!ValidValue(value))
            return "Value must be at most 2000 bytes without quotes or control characters";
        if (rule.kind == Kind::Text)
            return "";
        auto text = Trim(value);
        if (rule.kind == Kind::Bool)
        {
            auto lower = Lower(text);
            if (lower == "1" || lower == "true" || lower == "on") value = "1";
            else if (lower == "0" || lower == "false" || lower == "off") value = "0";
            else return "Value must be a boolean (0 or 1)";
            return "";
        }
        double number;
        if (!Number(text, number) || (rule.kind == Kind::Int && (!Integer(text) || std::abs(number) > 9007199254740991.0)))
            return rule.kind == Kind::Int ? "Value must be a whole number" : "Value must be a finite number";
        if ((rule.min && number < *rule.min) || (rule.max && number > *rule.max))
            return "Value is outside the configured range";
        value = text;
        return "";
    }

    bool ValidValue(std::string const& value)
    {
        return value.size() <= 2000 && std::none_of(value.begin(), value.end(), [](unsigned char c)
        {
            return c == '"' || c < 32 || c == 127;
        });
    }

    std::string Write(std::filesystem::path const& file, std::string const& key, std::string const& value)
    {
        if (!AllowedKey(key) || !ValidValue(value))
            return "Invalid setting key or value";

        std::error_code ec;
        auto status = std::filesystem::symlink_status(file, ec);
        if (ec || !std::filesystem::is_regular_file(status))
            return "Settings file must be an existing regular file";
        auto size = std::filesystem::file_size(file, ec);
        if (ec || size > MAX_CONFIG_BYTES)
            return "Cannot read settings file, or it exceeds 1 MiB";
        std::ifstream in(file, std::ios::binary);
        if (!in)
            return "Cannot read settings file";
        std::string content((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
        if (in.bad())
            return "Cannot read settings file";
        in.close();

        std::string bom;
        if (content.compare(0, 3, "\xEF\xBB\xBF") == 0)
        {
            bom = content.substr(0, 3);
            content.erase(0, 3);
        }
        std::string const newline = content.find("\r\n") == std::string::npos ? "\n" : "\r\n";
        bool const plain = !value.empty() && std::all_of(value.begin(), value.end(), [](unsigned char c)
            { return std::isalnum(c) || c == '.' || c == '-' || c == '_' || c == ':' || c == '/'; });
        std::string const written = key + " = " + (plain ? value : "\"" + value + "\"");
        std::stringstream input(content);
        std::string output = bom;
        bool replaced = false;
        for (std::string line; std::getline(input, line); )
        {
            if (!line.empty() && line.back() == '\r')
                line.pop_back();
            size_t start = line.find_first_not_of(" \t");
            if (start != std::string::npos && line.compare(start, key.size(), key) == 0)
            {
                size_t after = line.find_first_not_of(" \t", start + key.size());
                if (after != std::string::npos && line[after] == '=')
                {
                    // Updating all duplicates avoids a later assignment silently winning.
                    line = written;
                    replaced = true;
                }
            }
            output += line + newline;
            if (output.size() > MAX_CONFIG_BYTES)
                return "Updated settings file exceeds 1 MiB; no changes were made";
        }
        if (!replaced)
            output += written + newline;
        if (output.size() > MAX_CONFIG_BYTES)
            return "Updated settings file exceeds 1 MiB; no changes were made";

        std::filesystem::path backup = file;
        backup += ".dashboard.bak";
        std::filesystem::copy_file(file, backup, std::filesystem::copy_options::overwrite_existing, ec);
        if (ec)
            return "Cannot back up settings file; no changes were made";
        std::filesystem::path temp = file;
        temp += ".dashboard.tmp";
        auto fail = [&](std::string message)
        {
            std::error_code ignored;
            std::filesystem::remove(temp, ignored);
            return message;
        };
        // Copy first so the staging file inherits the config's access restrictions
        // before it contains any new data, including unrelated secrets in the file.
        std::filesystem::copy_file(file, temp, std::filesystem::copy_options::overwrite_existing, ec);
        if (ec)
            return fail("Cannot prepare temporary settings file");
        std::ofstream out(temp, std::ios::binary | std::ios::trunc);
        if (!out)
            return fail("Cannot open temporary settings file");
        out << output;
        out.close();
        if (!out)
            return fail("Cannot write temporary settings file");
        std::filesystem::permissions(temp, status.permissions(), ec);
        if (ec)
            return fail("Cannot preserve settings file permissions");
#ifdef _WIN32
        // ReplaceFile preserves the original Windows ACL and other file metadata.
        if (!ReplaceFileW(file.c_str(), temp.c_str(), nullptr, 0, nullptr, nullptr))
            return fail("Cannot replace settings file");
#else
        std::filesystem::rename(temp, file, ec);
        if (ec)
            return fail("Cannot replace settings file");
#endif
        return {};
    }
}
