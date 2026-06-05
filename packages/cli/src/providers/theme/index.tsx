import { createContext, useContext, useState, useCallback } from "react";
import type { ReactNode } from "react";

import {
  type ThemeColors,
  type Theme,
  DEFAULT_THEME,
  THEMES,
} from "./theme";
import {
  readGlobalConfig,
  updateGlobalConfig,
} from "../../utils/configs/global-config";
import {
  supportsTrueColor,
  quantizeThemeColors,
} from "../../utils/color-support";

const IS_TRUE_COLOR = supportsTrueColor();

function applyColorSupport(theme: Theme): Theme {
  if (IS_TRUE_COLOR) return theme;
  return { ...theme, colors: quantizeThemeColors(theme.colors) };
}

function getInitialTheme(): Theme {
  try {
    const config = readGlobalConfig();
    const saved = THEMES.find((t) => t.name === config.themeName);
    return applyColorSupport(saved ?? DEFAULT_THEME);
  } catch {
    return applyColorSupport(DEFAULT_THEME);
  }
}

type ThemeContextValue = {
  colors: ThemeColors;
  currentTheme: Theme;
  setTheme: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return value;
}

type ThemeProviderProps = {
  children: ReactNode;
};

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [currentTheme, setCurrentTheme] = useState<Theme>(getInitialTheme);

  const setTheme = useCallback((theme: Theme) => {
    setCurrentTheme(applyColorSupport(theme));
    try {
      updateGlobalConfig({ themeName: theme.name });
    } catch {
      // Ignore write failures so theme switching still works for this session.
    }
  }, []);

  return (
    <ThemeContext.Provider
      value={{ colors: currentTheme.colors, currentTheme, setTheme }}
    >
      {children}
    </ThemeContext.Provider>
  );
}
