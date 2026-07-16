/**
 * conformance.readiness.test.ts — TypeScript port of
 * scf-editor/scripts/test_readiness.py against the Hollow Creek fixture.
 *
 * The fixture plants gaps on purpose (Marcus's missing voice bundle and
 * thin vocal profile); these tests assert the readiness layer catches
 * exactly them and stays quiet where authored absence is a design decision.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { openFixture, type Fixture } from "./setup.ts";
import {
  readinessReport, type Finding, type ReadinessReport, type Severity,
} from "../src/readiness.ts";

let fx: Fixture;
let eleanor: number;
let marcus: number;
let sc12: number;
let sc16: number;
let sc21: number;
let shot1204: number;

const sev = (report: ReadinessReport, severity: Severity): Finding[] =>
  report.findings.filter((f) => f.severity === severity);

beforeAll(async () => {
  fx = openFixture();
  eleanor = await fx.oneId("character", "Eleanor");
  marcus = await fx.oneId("character", "Marcus");
  sc12 = await fx.sceneByNumber(12);
  sc16 = await fx.sceneByNumber(16);
  sc21 = await fx.sceneByNumber(21);
  shot1204 = await fx.oneId("shot", "12-04");
});

afterAll(() => fx.close());

describe("Marcus voice pass: the planted blockers", () => {
  test("missing voice bundle is a blocker; thin profile warns",
      async () => {
    const r = await readinessReport(fx.ctx, "Q05",
                                    { character_id: marcus,
                                      scene_id: sc12 });
    const blockers = sev(r, "blocker");
    expect(blockers.some(
      (f) => f.message.includes("voice_identity bundle"))).toBe(true);
    expect(r.findings.some(
      (f) => f.entity === "vocal_profile" &&
             f.severity === "warning")).toBe(true);
  });
});

describe("Eleanor voice pass: green, with the injury suggestion", () => {
  test("no blockers; authored absence is ok; injury surfaces suggestion",
      async () => {
    const r = await readinessReport(fx.ctx, "Q05",
                                    { character_id: eleanor,
                                      scene_id: sc12 });
    expect(sev(r, "blocker")).toEqual([]);
    expect(sev(r, "ok").some(
      (f) => f.message.includes("baseline holds"))).toBe(true);
    expect(sev(r, "suggestion").some(
      (f) => f.message.includes("color the voice"))).toBe(true);
    expect(r.findings.some(
      (f) => f.entity === "performance_beat" &&
             f.severity === "ok")).toBe(true);
  });
});

describe("Q06: staging present at sc12, environment gap for Marcus", () => {
  test("Eleanor sc12: no blockers, staging container found", async () => {
    const r = await readinessReport(fx.ctx, "Q06",
                                    { character_id: eleanor,
                                      scene_id: sc12 });
    expect(sev(r, "blocker")).toEqual([]);
    expect(sev(r, "ok").some(
      (f) => f.message.includes("blocking"))).toBe(true);
  });
  test("sc21: action sequence counts as staging container", async () => {
    const r = await readinessReport(fx.ctx, "Q06",
                                    { character_id: marcus,
                                      scene_id: sc21 });
    expect(r.findings.some(
      (f) => f.entity === "scene_blocking" &&
             f.severity === "ok")).toBe(true);
  });
});

describe("Q07: fully layered at sc12+shot; impoverished at sc16", () => {
  test("sc12+shot: no blockers, fully layered", async () => {
    const r = await readinessReport(fx.ctx, "Q07",
                                    { scene_id: sc12,
                                      shot_id: shot1204 });
    expect(sev(r, "blocker")).toEqual([]);
    expect(r.findings.every(
      (f) => f.severity !== "warning" ||
             f.message.includes("appearance"))).toBe(true);
  });
  test("sc16: missing palette flagged; latest-wins entry still in force",
      async () => {
    const r16 = await readinessReport(fx.ctx, "Q07", { scene_id: sc16 });
    expect(r16.findings.some(
      (f) => f.entity === "scene_color_palette" &&
             f.severity === "warning")).toBe(true);
    expect(r16.findings.some(
      (f) => f.entity === "color_script_entry" &&
             f.severity === "ok")).toBe(true);
    expect(sev(r16, "blocker")).toEqual([]);
  });
});

describe("Q08: sc12 green incl. authored silence; sc21 warns", () => {
  test("sc12: tacet counts as authored", async () => {
    const r = await readinessReport(fx.ctx, "Q08", { scene_id: sc12 });
    expect(sev(r, "blocker")).toEqual([]);
    expect(sev(r, "ok").some(
      (f) => f.message.includes("silence counts"))).toBe(true);
  });
  test("sc21: unauthored music flagged", async () => {
    const r21 = await readinessReport(fx.ctx, "Q08", { scene_id: sc21 });
    expect(r21.findings.some(
      (f) => f.entity === "scene_music_design" &&
             f.severity === "warning")).toBe(true);
  });
});

describe("Q13 / Q02", () => {
  test("Q13: Eleanor visual resolves incl. override", async () => {
    const r = await readinessReport(fx.ctx, "Q13", {
      subject: "character", subject_id: eleanor,
      intent: "visual_identity", scene_id: sc12, shot_id: shot1204,
    });
    expect(sev(r, "blocker")).toEqual([]);
    expect(sev(r, "ok").some(
      (f) => f.message.includes("from overrides"))).toBe(true);
  });
  test("Q02: Marcus appearance + costume gaps flagged", async () => {
    const r = await readinessReport(fx.ctx, "Q02",
                                    { character_id: marcus,
                                      scene_id: sc12 });
    expect(r.findings.some(
      (f) => f.entity === "character_appearance_profile" &&
             f.severity === "warning")).toBe(true);
    expect(r.findings.some(
      (f) => (f.entity === "costume" || f.entity === "costume_scene") &&
             f.severity === "warning")).toBe(true);
  });
});
