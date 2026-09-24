import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/renderer/App";

afterEach(() => {
  cleanup();
});

describe("App shell", () => {
  it("renders the desktop shell", async () => {
    window.forgeboard = {
      ping: vi.fn().mockResolvedValue({ app: "Forgeboard", version: "0.1.0" }),
    };

    render(<App />);

    expect(await screen.findByText("Forgeboard")).toBeInTheDocument();
    expect(await screen.findByText(/Ready · version 0\.1\.0/)).toBeInTheDocument();
  });
});
