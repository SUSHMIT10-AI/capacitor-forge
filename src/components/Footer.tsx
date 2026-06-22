import { Terminal } from "lucide-react";

const Footer = () => {
  return (
    <footer className="border-t border-border py-8">
      <div className="container flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-primary" />
          <span className="font-heading text-sm font-semibold text-foreground">AABforge</span>
        </div>
        <p className="text-xs text-muted-foreground">
          © {new Date().getFullYear()} AABforge. All rights reserved.
        </p>
      </div>
    </footer>
  );
};

export default Footer;
