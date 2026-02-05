"use client";

import Link from "next/link";
import { Map, Mail, MapPin } from "lucide-react";

export default function Footer() {
  return (
    <footer className="bg-stone-900 text-stone-300">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid md:grid-cols-4 gap-8">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-10 h-10 bg-emerald-700 rounded-lg flex items-center justify-center">
                <Map className="w-6 h-6 text-white" />
              </div>
              <div>
                <span className="font-bold text-lg text-white">Terra Firma™</span>
                <span className="text-sm text-stone-400 block -mt-1">Partners LLC</span>
              </div>
            </div>
            <p className="text-sm text-stone-400 max-w-xs">
              Professional land parcel analysis and mapping services across the United States.
            </p>
          </div>

          {/* Quick Links */}
          <div>
            <h4 className="font-semibold text-white mb-4">Quick Links</h4>
            <ul className="space-y-2">
              <li>
                <Link href="/map" className="text-sm hover:text-emerald-400 transition-colors">
                  Map Tool
                </Link>
              </li>
              <li>
                <Link href="/pricing" className="text-sm hover:text-emerald-400 transition-colors">
                  Pricing
                </Link>
              </li>
              <li>
                <Link href="/dashboard" className="text-sm hover:text-emerald-400 transition-colors">
                  My Account
                </Link>
              </li>
              <li>
                <a 
                  href="/api/free-look?v=20260205" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-sm hover:text-emerald-400 transition-colors"
                >
                  Free Look
                </a>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="font-semibold text-white mb-4">Legal</h4>
            <ul className="space-y-2">
              <li>
                <Link href="/terms" className="text-sm hover:text-emerald-400 transition-colors">
                  Terms of Service
                </Link>
              </li>
              <li>
                <Link href="/privacy" className="text-sm hover:text-emerald-400 transition-colors">
                  Privacy Policy
                </Link>
              </li>
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h4 className="font-semibold text-white mb-4">Contact</h4>
            <ul className="space-y-2">
              <li className="flex items-center gap-2 text-sm">
                <MapPin className="w-4 h-4 text-emerald-500" />
                Kansas City Metro Area
              </li>
              <li className="flex items-center gap-2 text-sm">
                <Mail className="w-4 h-4 text-emerald-500" />
                info@terrafirmapartners.com
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-stone-800 mt-8 pt-8 text-center text-sm text-stone-500">
          <p>© {new Date().getFullYear()} Terra Firma Partners™ LLC. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
