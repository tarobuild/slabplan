import assert from "node:assert/strict";
import { test } from "node:test";
import { normalize } from "./verify-schema-parity";

test("schema parity normalization keeps columns attached to their table", () => {
  const left = `
CREATE TABLE public.a (
    shared integer
);
CREATE TABLE public.b (
);
`;
  const right = `
CREATE TABLE public.a (
);
CREATE TABLE public.b (
    shared integer
);
`;

  assert.notEqual(normalize(left), normalize(right));
});

test("schema parity normalization preserves daily log singleton uniqueness", () => {
  const withUniqueIndex = `
CREATE TABLE public.daily_log_settings (
    singleton boolean DEFAULT false
);
CREATE UNIQUE INDEX daily_log_settings_singleton_unique ON public.daily_log_settings USING btree (singleton);
`;
  const withoutUnique = `
CREATE TABLE public.daily_log_settings (
    singleton boolean DEFAULT false
);
`;

  assert.notEqual(normalize(withUniqueIndex), normalize(withoutUnique));
});

test("schema parity normalization canonicalizes daily log singleton naming styles", () => {
  const asIndex = `
CREATE UNIQUE INDEX daily_log_settings_singleton_unique ON public.daily_log_settings USING btree (singleton);
`;
  const asConstraint = `
ALTER TABLE ONLY public.daily_log_settings
    ADD CONSTRAINT daily_log_settings_singleton UNIQUE (singleton);
`;

  assert.equal(normalize(asIndex), normalize(asConstraint));
});
