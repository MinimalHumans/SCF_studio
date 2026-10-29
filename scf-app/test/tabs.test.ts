// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, test } from "vitest";
import { useTabs } from "../src/state/tabs.ts";

beforeEach(() => { useTabs.setState({ tools: [], active: "project" }); });

describe("tool tabs", () => {
  test("opening a tool brings it to the front", () => {
    useTabs.getState().openTool("events");
    expect(useTabs.getState()).toMatchObject({
      tools: ["events"], active: "events" });
  });

  test("opening one that is open focuses it instead of adding another", () => {
    const { openTool, showProject } = useTabs.getState();
    openTool("events");
    showProject();
    openTool("events");
    expect(useTabs.getState().tools).toEqual(["events"]);
    expect(useTabs.getState().active).toBe("events");
  });

  test("closing the front tool returns to the project", () => {
    useTabs.getState().openTool("events");
    useTabs.getState().closeTool("events");
    expect(useTabs.getState()).toMatchObject({ tools: [], active: "project" });
  });

  test("closing a tool that is behind leaves the front where it was", () => {
    useTabs.getState().openTool("events");
    useTabs.getState().showProject();
    useTabs.getState().closeTool("events");
    expect(useTabs.getState().active).toBe("project");
  });
});
