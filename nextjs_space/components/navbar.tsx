"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { motion, AnimatePresence } from "framer-motion";
import { Map, User, LogOut, Menu, X, Shield, LayoutDashboard } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Navbar() {
  const pathname = usePathname();
  const sessionData = useSession();
  const session = sessionData?.data;
  const status = sessionData?.status ?? "loading";
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const isAdmin = session?.user?.role === "admin";

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        isScrolled
          ? "bg-white/95 backdrop-blur-md shadow-md"
          : "bg-white/80 backdrop-blur-sm"
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <div className="w-10 h-10 bg-emerald-700 rounded-lg flex items-center justify-center">
              <Map className="w-6 h-6 text-white" />
            </div>
            <div className="hidden sm:block">
              <span className="font-bold text-lg text-emerald-800">Terra Firma</span>
              <span className="text-[11px] text-stone-400 block -mt-0.5 tracking-wide uppercase">Land Intelligence</span>
            </div>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-4">
            <NavLink href="/" active={pathname === "/"}>
              Home
            </NavLink>
            <NavLink href="/map" active={pathname === "/map"}>
              Map Tool
            </NavLink>
            <NavLink href="/listings" active={pathname?.startsWith("/listings")}>
              Marketplace
            </NavLink>
            <NavLink href="/pricing" active={pathname === "/pricing"}>
              Pricing
            </NavLink>
            <NavLink href="/brokers" active={pathname === "/brokers"}>
              For Brokers
            </NavLink>
            <NavLink href="/our-story" active={pathname === "/our-story"}>
              Our Story
            </NavLink>

            {!mounted || status === "loading" ? (
              <div className="w-8 h-8 rounded-full bg-stone-200 animate-pulse" />
            ) : session ? (
              <div className="flex items-center gap-3">
                <Link href="/dashboard">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-stone-700 hover:text-emerald-700"
                  >
                    <LayoutDashboard className="w-4 h-4 mr-2" />
                    Dashboard
                  </Button>
                </Link>
                {isAdmin && (
                  <Link href="/admin">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-amber-700 hover:text-amber-800"
                    >
                      <Shield className="w-4 h-4 mr-2" />
                      Admin
                    </Button>
                  </Link>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => signOut()}
                  className="text-stone-700"
                >
                  <LogOut className="w-4 h-4 mr-2" />
                  Sign Out
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Link href="/login">
                  <Button variant="ghost" size="sm">
                    Sign In
                  </Button>
                </Link>
                <Link href="/signup">
                  <Button
                    size="sm"
                    className="bg-emerald-700 hover:bg-emerald-800 text-white"
                  >
                    Get Started
                  </Button>
                </Link>
              </div>
            )}
          </div>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="md:hidden p-2 text-stone-600 hover:text-stone-900"
          >
            {isMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      <AnimatePresence>
        {isMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden bg-white border-t border-stone-200"
          >
            <div className="px-4 py-4 space-y-2">
              <MobileNavLink href="/" onClick={() => setIsMenuOpen(false)}>
                Home
              </MobileNavLink>
              <MobileNavLink href="/map" onClick={() => setIsMenuOpen(false)}>
                Map Tool
              </MobileNavLink>
              <MobileNavLink href="/listings" onClick={() => setIsMenuOpen(false)}>
                Marketplace
              </MobileNavLink>
              <MobileNavLink href="/pricing" onClick={() => setIsMenuOpen(false)}>
                Pricing
              </MobileNavLink>
              <MobileNavLink href="/brokers" onClick={() => setIsMenuOpen(false)}>
                For Brokers
              </MobileNavLink>
              <MobileNavLink href="/our-story" onClick={() => setIsMenuOpen(false)}>
                Our Story
              </MobileNavLink>

              <div className="pt-4 border-t border-stone-200">
                {mounted && session ? (
                  <>
                    <MobileNavLink href="/dashboard" onClick={() => setIsMenuOpen(false)}>
                      Dashboard
                    </MobileNavLink>
                    {isAdmin && (
                      <MobileNavLink href="/admin" onClick={() => setIsMenuOpen(false)}>
                        Admin Panel
                      </MobileNavLink>
                    )}
                    <button
                      onClick={() => {
                        signOut();
                        setIsMenuOpen(false);
                      }}
                      className="w-full text-left px-4 py-2 text-stone-600 hover:bg-stone-100 rounded-lg"
                    >
                      Sign Out
                    </button>
                  </>
                ) : mounted ? (
                  <>
                    <MobileNavLink href="/login" onClick={() => setIsMenuOpen(false)}>
                      Sign In
                    </MobileNavLink>
                    <MobileNavLink href="/signup" onClick={() => setIsMenuOpen(false)}>
                      Create Account
                    </MobileNavLink>
                  </>
                ) : null}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
        active
          ? "text-emerald-700 bg-emerald-50"
          : "text-stone-600 hover:text-emerald-700 hover:bg-stone-50"
      }`}
    >
      {children}
    </Link>
  );
}

function MobileNavLink({
  href,
  onClick,
  children,
}: {
  href: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="block px-4 py-2 text-stone-600 hover:bg-stone-100 rounded-lg"
    >
      {children}
    </Link>
  );
}
