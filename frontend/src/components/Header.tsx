import { Button } from "./ui/button";
import masumiLogo from "@/assets/masumi_logo.png";
import { MessageSquare } from "lucide-react";

interface HeaderProps {
  title?: string;
}

export function Header({ title }: HeaderProps) {
  return (
    <header className="fixed top-0 left-0 right-0 border-b border-border bg-background/80 backdrop-blur-sm justify-center">
      <div className={`p-4 grid grid-cols-${title ? '3' : '2'} items-center max-w-10xl mx-auto`}>
        <div className="flex items-center">
          <img src={masumiLogo?.src} alt="Masumi" className="h-4" />
        </div>
        {title && (
          <div className="flex items-center justify-center">
            <span className="text-sm font-medium">{title}</span>
          </div>
        )}
        <div className="flex justify-end">
          <Button 
            variant="outline"
            className="text-sm flex items-center gap-2"
          >
            Support
            <MessageSquare className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>
  );
} 