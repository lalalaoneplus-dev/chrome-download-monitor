import assert from "node:assert/strict";
import test from "node:test";

import { reconcileLogEntries } from "../src/log-dom.js";

function makeEntry(id) {
  return {
    dataset: { entryId: id },
    detailsOpen: false,
    codeScrollTop: 0
  };
}

function makeContainer(view, children) {
  return {
    dataset: { view },
    children,
    querySelectorAll() {
      return this.children;
    },
    replaceChildren(...nextChildren) {
      this.children = nextChildren;
    }
  };
}

test("reuses open technical rows when new log events arrive", () => {
  const inspectedEntry = makeEntry("existing-event");
  inspectedEntry.detailsOpen = true;
  inspectedEntry.codeScrollTop = 420;
  const container = makeContainer("technical", [inspectedEntry]);

  const rendered = reconcileLogEntries(
    container,
    [{ id: "new-event" }, { id: "existing-event" }],
    "technical",
    (entry) => makeEntry(entry.id),
    (element, entry) => {
      element.updatedWith = entry.id;
    }
  );

  assert.equal(rendered[1], inspectedEntry);
  assert.equal(rendered[1].updatedWith, "existing-event");
  assert.equal(rendered[1].detailsOpen, true);
  assert.equal(rendered[1].codeScrollTop, 420);
});

test("creates fresh rows when switching log views", () => {
  const technicalEntry = makeEntry("event-1");
  technicalEntry.detailsOpen = true;
  const container = makeContainer("technical", [technicalEntry]);

  const rendered = reconcileLogEntries(
    container,
    [{ id: "event-1" }],
    "natural",
    (entry) => makeEntry(entry.id)
  );

  assert.notEqual(rendered[0], technicalEntry);
});
