// node --test tests/settings.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { describe, validate, grouped } from "../web/js/lib/settings.js";

test("a known key has its label and kind; an unknown one shows as text under its own name", () => {
  assert.equal(describe("OllamaChat.Conversation.Enable").kind, "bool");
  const unknown = describe("Some.Other.Key");
  assert.deepEqual([unknown.label, unknown.kind, unknown.group], ["Some.Other.Key", "text", "Other"]);
});

test("switches send 1 or 0", () => {
  assert.deepEqual(validate("OllamaChat.Delivery.Split", true), { value: "1" });
  assert.deepEqual(validate("OllamaChat.Delivery.Split", "off"), { value: "0" });
  assert.ok(validate("OllamaChat.Delivery.Split", "maybe").error);
});

test("encounter tracking and automatic resets are separate playerbot switches", () => {
  for (const key of ["AiPlayerbot.PersistentProgression.AnchorOnMeeting", "AiPlayerbot.LevelBrackets.Enabled", "AiPlayerbot.ResetBotLevel.Enabled"]) {
    assert.equal(describe(key).kind, "bool");
    assert.equal(describe(key).group, "Playerbots");
    assert.deepEqual(validate(key, "on"), { value: "1" });
  }
  assert.match(describe("AiPlayerbot.LevelBrackets.Enabled").help, /Ignored for protected bots/);
  assert.match(describe("AiPlayerbot.ResetBotLevel.Enabled").help, /can still affect unmet bots/);
  assert.match(describe("AiPlayerbot.PersistentProgression.AnchorOnMeeting").help, /Requires persistence mode 1 or 2/);
  assert.deepEqual(validate("AiPlayerbot.PersistentProgression.AnchorOnMeeting", "off"), { value: "0" });
  assert.ok(validate("AiPlayerbot.PersistentProgression.AnchorOnMeeting", "maybe").error);
});

test("persistence modes retain mode 2 and validate anchor controls", () => {
  for (const mode of ["0", "1", "2"]) {
    assert.deepEqual(validate("AiPlayerbot.PersistentProgression", mode), { value: mode });
  }
  for (const mode of ["-1", "3", "1.5", "on"]) {
    assert.ok(validate("AiPlayerbot.PersistentProgression", mode).error);
  }
  assert.deepEqual(validate("AiPlayerbot.PersistentProgression.FollowGap", "0"), { value: "0" });
  assert.ok(validate("AiPlayerbot.PersistentProgression.FollowGap", "-1").error);
  assert.ok(validate("AiPlayerbot.PersistentProgression.AnchorInterval", "29").error);
  assert.deepEqual(validate("AiPlayerbot.PersistentProgression.AnchorInterval", "300"), { value: "300" });
});

test("numbers must be whole and in range", () => {
  assert.deepEqual(validate("OllamaChat.Conversation.HoldSeconds", " 90 "), { value: "90" });
  assert.match(validate("OllamaChat.Conversation.HoldSeconds", "5").error, /at least 10/);
  assert.match(validate("OllamaChat.Conversation.HoldSeconds", "1.5").error, /whole/);
  assert.match(validate("OllamaChat.PlayerReplyChance.Say", "101").error, /at most 100/);
});

test("text is one line with no double quote, which the server's config parser would strip", () => {
  assert.deepEqual(validate("OllamaChat.Reply.Model", "quality"), { value: "quality" });
  assert.ok(validate("OllamaChat.Reply.Model", 'say "hi"').error);
  assert.ok(validate("OllamaChat.Reply.Model", "a\nb").error);
  assert.ok(validate("OllamaChat.Reply.Model", "a\0b").error);
  assert.ok(validate("OllamaChat.Reply.Model", "x".repeat(2001)).error);
});

test("settings are grouped, known ones in their listed order, unknown last", () => {
  const groups = grouped([
    { key: "Zeta.Key", value: "x" },
    { key: "OllamaChat.Conversation.HoldSeconds", value: "120" },
    { key: "OllamaChat.Conversation.Enable", value: "1" },
    { key: "OllamaChat.Delivery.Split", value: "1" },
  ]);
  assert.deepEqual(groups.map(g => g.group), ["Conversation", "Replies", "Other"]);
  assert.deepEqual(groups[0].items.map(s => s.key),
    ["OllamaChat.Conversation.Enable", "OllamaChat.Conversation.HoldSeconds"]);
});

test("server type and range rules apply to both known and unlabelled keys", () => {
  assert.equal(describe("Other.Flag", { kind: "bool" }).kind, "bool");
  assert.deepEqual(validate("Other.Flag", true, { kind: "bool" }), { value: "1" });
  const distance = { kind: "number", min: 5, max: 100 };
  assert.deepEqual(validate("OllamaChat.Conversation.MaxDistance", "12.5", distance), { value: "12.5" });
  for (const value of ["", "NaN", "Infinity", "0x20", "101", "4"]) {
    assert.ok(validate("OllamaChat.Conversation.MaxDistance", value, distance).error);
  }
  assert.ok(validate("Other.Integer", "9007199254740992", { kind: "int" }).error);
  assert.ok(validate("Other.Text", "Ã©".repeat(1001)).error);
});

test("explicit server rules replace default UI limits", () => {
  assert.deepEqual(validate("OllamaChat.Delivery.MaxMessages", "12", { kind: "int" }), { value: "12" });
  assert.deepEqual(validate("OllamaChat.Conversation.MaxDistance", "12.5"), { value: "12.5" });
});
