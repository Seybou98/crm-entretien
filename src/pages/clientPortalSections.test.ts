import { describe, expect, it } from "vitest";

import { CLIENT_PORTAL_SECTIONS, getClientPortalSectionCopy } from "./clientPortalSections";

describe("clientPortalSections", () => {
  it("includes the FAQ section in portal navigation", () => {
    expect(CLIENT_PORTAL_SECTIONS.some((section) => section.id === "faq")).toBe(true);
  });

  it("returns a dedicated title and description for the FAQ section", () => {
    const copy = getClientPortalSectionCopy("faq");

    expect(copy.title).toContain("FAQ");
    expect(copy.description).toContain("questions");
  });
});
