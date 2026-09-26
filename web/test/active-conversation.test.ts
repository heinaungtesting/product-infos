import assert from "node:assert/strict";
import { test } from "node:test";
import { readActiveConversation, saveActiveConversation } from "../lib/active-conversation";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

test("new general thread remains selected after remount and is scoped away from job threads", () => {
  const s = storage();
  const thread = "job-os:1790408575960";
  saveActiveConversation("job-os", thread, s);
  assert.equal(readActiveConversation("job-os", s), thread);
  assert.equal(readActiveConversation("job-os:acme", s), "job-os:acme");
});

test("job thread remains selected after remount and ignores another scope's thread", () => {
  const s = storage();
  saveActiveConversation("job-os:acme", "job-os:acme:1790408575960", s);
  assert.equal(readActiveConversation("job-os:acme", s), "job-os:acme:1790408575960");
  assert.equal(readActiveConversation("job-os:other", s), "job-os:other");
});

test("invalid or unrelated saved thread falls back to the scope", () => {
  const s = storage();
  s.setItem("job-os-active:job-os", "job-os:acme:1790408575960");
  assert.equal(readActiveConversation("job-os", s), "job-os");
});
