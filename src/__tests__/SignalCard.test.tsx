import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  SignalCard,
  SignalCardSkeleton,
} from "@/components/dashboard/SignalCard";

// Mock the i18n provider
const mockT = (key: string) => key;
const mockI18n = {
  t: mockT,
  locale: "zh" as const,
  setLocale: () => {},
  dateLocale: "zh-CN",
};

import * as i18nProvider from "@/lib/i18n/provider";
import { vi } from "vitest";
vi.mock("@/lib/i18n/provider", () => ({
  useI18n: () => mockI18n,
}));

describe("SignalCard", () => {
  const baseSignal = {
    id: "1",
    symbol: "AAPL",
    direction: "bullish" as const,
    confidence: 0.85,
    signal_type: "insider_activity",
    signal_score: 85,
    module: "insider_trades",
    summary: "Strong insider buying activity",
    analysis: "CEO purchased 10,000 shares",
    factors: {},
    created_at: new Date().toISOString(),
  };

  it("renders symbol correctly", () => {
    render(<SignalCard signal={baseSignal} />);
    expect(screen.getByText("$AAPL")).toBeInTheDocument();
  });

  it("displays confidence as percentage", () => {
    render(<SignalCard signal={baseSignal} />);
    expect(screen.getByText("85%")).toBeInTheDocument();
  });

  it("shows bullish direction", () => {
    render(<SignalCard signal={baseSignal} />);
    expect(screen.getByText("signal.bullish")).toBeInTheDocument();
  });

  it("shows bearish direction", () => {
    const bearishSignal = { ...baseSignal, direction: "bearish" as const };
    render(<SignalCard signal={bearishSignal} />);
    expect(screen.getByText("signal.bearish")).toBeInTheDocument();
  });

  it("shows module tag", () => {
    render(<SignalCard signal={baseSignal} />);
    expect(screen.getByText("insider_trades")).toBeInTheDocument();
  });
});

describe("SignalCardSkeleton", () => {
  it("renders without crashing", () => {
    const { container } = render(<SignalCardSkeleton />);
    expect(container.firstChild).toBeTruthy();
  });

  it("has animate-pulse class", () => {
    const { container } = render(<SignalCardSkeleton />);
    expect(container.firstChild).toHaveClass("animate-pulse");
  });
});
