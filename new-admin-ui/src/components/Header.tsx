import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/contexts/ThemeContext";
import { Sun, Moon } from "lucide-react";
import Image from "next/image";
import logo from "@/assets/masumi_logo.png";

export function Header() {
  const { theme, setThemePreference } = useTheme();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b bg-background/80 backdrop-blur-md">
      <div className="max-w-[1400px] mx-auto w-full">
        <div className="h-14 px-4 flex items-center justify-between gap-4">
          <Image
            src={logo}
            alt="Masumi Logo"
            width={120}
            height={32}
            className="w-auto"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setThemePreference(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </header>
  );
} 