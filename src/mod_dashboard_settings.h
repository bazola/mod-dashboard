#pragma once

#include <filesystem>
#include <optional>
#include <string>

namespace DashboardSettings
{
    enum class Kind { Text, Bool, Int, Number };
    struct Rule
    {
        Kind kind = Kind::Text;
        std::optional<double> min;
        std::optional<double> max;
    };

    // Never expose credentials or the dashboard's own write destinations.
    bool AllowedKey(std::string const& key);
    char const* KindName(Kind kind);
    bool ParseRule(std::string const& spec, Rule& rule);
    Rule InferRule(std::string const& active);
    // An empty result means success. Boolean and numeric whitespace is normalized.
    std::string Validate(Rule const& rule, std::string& value);

    // ConfigMgr removes quotes and cannot round-trip control characters.
    bool ValidValue(std::string const& value);

    // Replace every active assignment of key, or append it. Keep a backup and
    // atomically replace the file. An empty result means success.
    std::string Write(std::filesystem::path const& file, std::string const& key, std::string const& value);
}
