import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Terminal, Menu, X } from "lucide-react";
import { useState } from "react";

const Navbar = () => {
  const [open, setOpen] = useState(false);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 glass">
      <div className="container flex h-16 items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/20">
            <Terminal className="h-5 w-5 text-primary" />
          </div>
          <span className="font-heading text-lg font-bold text-foreground">
            AABforge
          </span>
        </Link>

        <div className="hidden items-center gap-6 md:flex">
          <Link to="/#features" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Features
          </Link>
          <Link to="/#how-it-works" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            How It Works
          </Link>
          <Link to="/auth" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Login
          </Link>
          <Button variant="hero" size="sm" asChild>
            <Link to="/auth?tab=signup">Get Started</Link>
          </Button>
        </div>

        <button className="md:hidden text-foreground" onClick={() => setOpen(!open)}>
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open && (
        <div className="md:hidden glass border-t border-border p-4 space-y-3">
          <Link to="/auth" className="block text-sm text-muted-foreground" onClick={() => setOpen(false)}>Login</Link>
          <Button variant="hero" size="sm" className="w-full" asChild>
            <Link to="/auth?tab=signup" onClick={() => setOpen(false)}>Get Started</Link>
          </Button>
        </div>
      )}
    </nav>
  );
};

export default Navbar;
