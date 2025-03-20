import { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'dark' | 'light';
type ThemePreference = Theme | 'auto';

interface ThemeContextType {
  theme: Theme;
  preference: ThemePreference;
  setThemePreference: (preference: ThemePreference) => void;
  isChangingTheme: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const [theme, setTheme] = useState<Theme>('light');
  const [preference, setPreference] = useState<ThemePreference>('auto');
  const [isChangingTheme, setIsChangingTheme] = useState(false);

  useEffect(() => {
    const savedPreference = localStorage.getItem('theme-preference') as ThemePreference | null;
    
    if (savedPreference) {
      setPreference(savedPreference);
      if (savedPreference !== 'auto') {
        setTheme(savedPreference);
        document.documentElement.classList.remove('light', 'dark');
        document.documentElement.classList.add(savedPreference);
      }
    }
    
    if (!savedPreference || savedPreference === 'auto') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const systemTheme = mediaQuery.matches ? 'dark' : 'light';
      setTheme(systemTheme);
      document.documentElement.classList.remove('light', 'dark');
      document.documentElement.classList.add(systemTheme);
    }
    
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    
    const handleSystemThemeChange = (e: MediaQueryListEvent | MediaQueryList) => {
      if (preference === 'auto') {
        const newTheme = e.matches ? 'dark' : 'light';
        setTheme(newTheme);
        document.documentElement.classList.remove('light', 'dark');
        document.documentElement.classList.add(newTheme);
      }
    };

    handleSystemThemeChange(mediaQuery);

    mediaQuery.addEventListener('change', handleSystemThemeChange);

    return () => {
      mediaQuery.removeEventListener('change', handleSystemThemeChange);
    };
  }, [preference, mounted]);

  const setThemePreference = (newPreference: ThemePreference) => {
    setIsChangingTheme(true);
    setPreference(newPreference);
    
    if (newPreference === 'auto') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const systemTheme = mediaQuery.matches ? 'dark' : 'light';
      setTheme(systemTheme);
      document.documentElement.classList.remove('light', 'dark');
      document.documentElement.classList.add(systemTheme);
      localStorage.setItem('theme-preference', 'auto');
    } else {
      setTheme(newPreference);
      document.documentElement.classList.remove('light', 'dark');
      document.documentElement.classList.add(newPreference);
      localStorage.setItem('theme-preference', newPreference);
    }
    
    setTimeout(() => {
      setIsChangingTheme(false);
    }, 500);
  };

  if (!mounted) {
    return <div style={{ visibility: 'hidden' }}>{children}</div>;
  }

  return (
    <ThemeContext.Provider value={{ theme, preference, setThemePreference, isChangingTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
} 