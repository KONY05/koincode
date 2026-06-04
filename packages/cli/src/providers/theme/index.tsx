import { createContext, useContext, useState, useCallback } from "react";
import type { ReactNode } from "react";

import type { ThemeColors, Theme } from "../../theme";
import { DEFAULT_THEME, THEMES } from "../../theme";
import {
  readGlobalConfig,
  updateGlobalConfig,
} from "../../utils/configs/global-config";

function getInitialTheme(): Theme {
  try {
    const config = readGlobalConfig();
    const saved = THEMES.find((t) => t.name === config.themeName);
    return saved ?? DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
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
    setCurrentTheme(theme);
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
