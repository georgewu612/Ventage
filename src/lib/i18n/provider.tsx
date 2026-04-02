"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { defaultLocale, Locale, messages } from "@/lib/i18n/messages";

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string) => string;
  dateLocale: string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    if (typeof window === "undefined") {
      return defaultLocale;
    }
    const stored = window.localStorage.getItem("ventage_locale");
    return stored === "zh" || stored === "en" ? stored : defaultLocale;
  });

  useEffect(() => {
    window.localStorage.setItem("ventage_locale", locale);
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<I18nContextValue>(() => {
    const dict = messages[locale];

    return {
      locale,
      setLocale: setLocaleState,
      t: (key: string) => dict[key] ?? key,
      dateLocale: locale === "zh" ? "zh-CN" : "en-US",
    };
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within LocaleProvider");
  }
  return context;
}
