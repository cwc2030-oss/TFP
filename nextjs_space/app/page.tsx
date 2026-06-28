"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { motion, useInView } from "framer-motion";
import {
  Map,
  FileText,
  Layers,
  Shield,
  CheckCircle,
  ArrowRight,
  Waves,
  Mountain,
  Zap,
  LayoutGrid,
  Target,
  TreePine,
  Droplets,
  MapPin,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MAP_LAYERS } from "@/lib/map-layers";
import { trackAddressSearch } from "@/lib/gtag";


export default function HomePage() {
  return (
    <div className="pt-16">
      {/* Hero Section */}
      <HeroSection />

      {/* Fun Facts Banner */}
      <FunFactsBanner />

      {/* Hunting Focus Section */}
      <HuntingFocusSection />

      {/* Features Section */}
      <FeaturesSection />

      {/* Map Layers Section */}
      <MapLayersSection />

      {/* How It Works Section */}
      <HowItWorksSection />

      {/* CTA Section */}
      <CTASection />
    </div>
  );
}

function HeroSection() {
  const [address, setAddress] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [suggestions, setSuggestions] = useState<Array<{description: string, place_id: string, lat?: number, lng?: number}>>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  
  // Google Places Autocomplete
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node) &&
          inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const fetchSuggestions = async (input: string) => {
    if (input.length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    
    try {
      // Mapbox-powered autocomplete via proxy
      const res = await fetch(`/api/places-autocomplete?input=${encodeURIComponent(input)}`);
      const data = await res.json();
      
      if (data.predictions) {
        setSuggestions(data.predictions.slice(0, 5));
        setShowSuggestions(true);
      }
    } catch (err) {
      console.error('Autocomplete error:', err);
    }
  };
  
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setAddress(value);
    // Debounce autocomplete to avoid excessive API calls
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(value), 300);
  };
  
  const handleSuggestionClick = async (suggestion: {description: string, place_id: string, lat?: number, lng?: number}) => {
    setAddress(suggestion.description);
    setShowSuggestions(false);
    setIsSearching(true);
    setSearchError('');
    
    try {
      // Coordinates are pre-resolved from the autocomplete proxy
      if (suggestion.lat && suggestion.lng) {
        trackAddressSearch(suggestion.description);
        router.push(`/preview?lat=${suggestion.lat}&lng=${suggestion.lng}&address=${encodeURIComponent(suggestion.description)}`);
        return;
      }
      
      // Fallback: geocode via Mapbox
      const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
      const geocodeUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(suggestion.description)}.json?access_token=${mapboxToken}&country=us&limit=1`;
      
      const res = await fetch(geocodeUrl);
      const data = await res.json();
      
      if (data.features && data.features.length > 0) {
        const [lng, lat] = data.features[0].center;
        trackAddressSearch(suggestion.description);
        router.push(`/preview?lat=${lat}&lng=${lng}&address=${encodeURIComponent(suggestion.description)}`);
      } else {
        setSearchError('Could not locate address.');
        setIsSearching(false);
      }
    } catch (err) {
      setSearchError('Search failed. Please try again.');
      setIsSearching(false);
    }
  };
  
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address.trim()) return;
    
    setIsSearching(true);
    setSearchError('');
    setShowSuggestions(false);
    
    // Coordinate shortcut: if input matches "lat, lng" (e.g. "38.88311, -95.03943"),
    // skip geocoding and jump straight to the terrain analyzer.
    const coordPattern = /^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/;
    const coordMatch = address.trim().match(coordPattern);
    if (coordMatch) {
      const lat = parseFloat(coordMatch[1]);
      const lng = parseFloat(coordMatch[2]);
      if (!Number.isNaN(lat) && !Number.isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        trackAddressSearch(`${lat}, ${lng}`);
        router.push(`/intel?lat=${lat}&lng=${lng}`);
        return;
      }
    }
    
    try {
      // Geocode the address using Mapbox Geocoding API
      const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
      const geocodeUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json?access_token=${mapboxToken}&country=us&limit=1`;
      
      const res = await fetch(geocodeUrl);
      const data = await res.json();
      
      if (data.features && data.features.length > 0) {
        const [lng, lat] = data.features[0].center;
        const formattedAddress = data.features[0].place_name;
        
        // Track & redirect to cinematic preview
        trackAddressSearch(formattedAddress);
        router.push(`/preview?lat=${lat}&lng=${lng}&address=${encodeURIComponent(formattedAddress)}`);
      } else {
        setSearchError('Address not found. Try including city and state.');
        setIsSearching(false);
      }
    } catch (err) {
      setSearchError('Search failed. Please try again.');
      setIsSearching(false);
    }
  };
  
  return (
    <section className="relative min-h-[85vh] flex items-center overflow-hidden">
      {/* Background - warmer, more natural */}
      <div className="absolute inset-0 bg-gradient-to-br from-stone-800 via-emerald-900 to-stone-900">
        <div className="absolute inset-0 opacity-10 bg-[url('/tfp-social.gif')] bg-center bg-no-repeat bg-contain" />
      </div>

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Left side - Copy + Address Input */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8 }}
          >
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white mb-6 leading-tight">
              See your land
              <span className="block text-emerald-400 mt-2">in 3D. Free.</span>
            </h1>
            
            <p className="text-xl text-stone-300 mb-8 leading-relaxed">
              Enter any address. We&apos;ll show you the terrain — ridges, valleys, 
              creek bottoms — in a spinning 3D flyover. Takes 10 seconds.
            </p>

            {/* Address Search Form */}
            <form onSubmit={handleSearch} className="mb-6">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1 relative">
                  <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-stone-400 z-10" />
                  <input
                    ref={inputRef}
                    type="text"
                    value={address}
                    onChange={handleInputChange}
                    onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                    placeholder="Enter property address..."
                    className="w-full pl-12 pr-4 py-4 bg-stone-800/80 border border-stone-600 rounded-xl text-white placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-lg"
                    autoComplete="off"
                  />
                  {/* Autocomplete Suggestions */}
                  {showSuggestions && suggestions.length > 0 && (
                    <div 
                      ref={suggestionsRef}
                      className="absolute top-full left-0 right-0 mt-1 bg-stone-800 border border-stone-600 rounded-xl overflow-hidden z-50 shadow-xl"
                    >
                      {suggestions.map((suggestion, i) => (
                        <button
                          key={suggestion.place_id}
                          type="button"
                          onClick={() => handleSuggestionClick(suggestion)}
                          className="w-full px-4 py-3 text-left text-white hover:bg-stone-700 flex items-center gap-3 border-b border-stone-700 last:border-0"
                        >
                          <MapPin className="w-4 h-4 text-stone-400 flex-shrink-0" />
                          <span className="truncate">{suggestion.description}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <Button
                  type="submit"
                  disabled={isSearching || !address.trim()}
                  size="lg"
                  className="bg-emerald-500 text-white hover:bg-emerald-600 shadow-lg px-8 text-lg whitespace-nowrap disabled:opacity-50"
                >
                  {isSearching ? (
                    <>
                      <span className="animate-spin mr-2">⏳</span>
                      Loading...
                    </>
                  ) : (
                    <>
                      <Mountain className="w-5 h-5 mr-2" />
                      View in 3D
                    </>
                  )}
                </Button>
              </div>
              {searchError && (
                <p className="text-red-400 text-sm mt-2">{searchError}</p>
              )}
            </form>

            {/* Secondary CTAs — Flow Score lead magnet + Terrain Brain demo */}
            <div className="mb-6 flex flex-wrap gap-4">
              <Link
                href="/flow-score"
                className="inline-flex items-center gap-2 text-amber-300 hover:text-amber-200 underline-offset-4 hover:underline transition-colors text-base font-medium"
              >
                Get your free Flow Score
                <ArrowRight className="w-4 h-4" />
              </Link>
              <Link
                href="/demo"
                className="inline-flex items-center gap-2 text-emerald-300 hover:text-emerald-200 underline-offset-4 hover:underline transition-colors text-base font-medium"
              >
                Or see The Terrain Brain in action
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>

            <p className="text-stone-400 text-sm mb-6">
              Try: <button type="button" onClick={() => setAddress('425 SE 850th Rd, Leeton, MO')} className="text-emerald-400 hover:underline">425 SE 850th Rd, Leeton, MO</button>
              {' '} or {' '}
              <button type="button" onClick={() => setAddress('761 Schlessman Rd, Pineville, MO')} className="text-emerald-400 hover:underline">761 Schlessman Rd, Pineville, MO</button>
            </p>

            <div className="flex flex-wrap gap-4 text-stone-400 text-sm">
              <span className="flex items-center gap-1">
                <CheckCircle className="w-4 h-4 text-emerald-500" />
                No signup required
              </span>
              <span className="flex items-center gap-1">
                <CheckCircle className="w-4 h-4 text-emerald-500" />
                Works for any US address
              </span>
              <span className="flex items-center gap-1">
                <CheckCircle className="w-4 h-4 text-emerald-500" />
                Instant results
              </span>
            </div>
          </motion.div>

          {/* Right side - Mascot GIF */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="hidden lg:flex justify-center items-center"
          >
            <div className="relative">
              <div className="absolute -inset-4 bg-emerald-500/20 rounded-full blur-3xl" />
              <Image
                src="/tfp-social.gif"
                alt="Terra Firma Partners - Deer and Turkey"
                width={400}
                height={400}
                className="relative rounded-2xl shadow-2xl"
                unoptimized
              />
              <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 bg-stone-800 px-4 py-2 rounded-full border border-stone-600">
                <p className="text-stone-300 text-sm font-medium">Missouri&apos;s Land Intel Folks</p>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

function FunFactsBanner() {
  const facts = [
    "🦌 Missouri harvested 297,000+ deer last season",
    "📍 We cover all 114 Missouri counties",
    "🗺️ Over 150,000 parcels in our database",
    "🎯 CWD detected in 47 Missouri counties",
  ];
  
  const [currentFact, setCurrentFact] = useState(0);
  
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentFact((prev) => (prev + 1) % facts.length);
    }, 4000);
    return () => clearInterval(timer);
  }, [facts.length]);

  return (
    <div className="bg-amber-500 py-3 overflow-hidden">
      <div className="max-w-7xl mx-auto px-4">
        <motion.p
          key={currentFact}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="text-center text-stone-900 font-medium"
        >
          {facts[currentFact]}
        </motion.p>
      </div>
    </div>
  );
}

function HuntingFocusSection() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });

  const huntingFeatures = [
    {
      icon: Target,
      title: "CWD Status",
      subtitle: "Is the herd healthy?",
      description: "We'll tell you straight up if Chronic Wasting Disease has been found in that county. It matters for regulations and long-term herd health.",
      color: "text-red-500",
      bgColor: "bg-red-900/30",
      borderColor: "border-red-800",
    },
    {
      icon: TreePine,
      title: "Harvest Pressure",
      subtitle: "How hard is it hunted?",
      description: "County harvest numbers tell a story. Light pressure often means bigger bucks. We break down the density so you know what you're getting into.",
      color: "text-amber-400",
      bgColor: "bg-amber-900/30",
      borderColor: "border-amber-800",
    },
    {
      icon: Droplets,
      title: "Drought Monitor",
      subtitle: "What's the water situation?",
      description: "Dry ground changes everything — deer patterns, food plot potential, even property value. We show you current conditions.",
      color: "text-blue-400",
      bgColor: "bg-blue-900/30",
      borderColor: "border-blue-800",
    },
  ];

  return (
    <section ref={ref} className="py-20 bg-stone-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
            The Stuff Nobody Else Tells You
          </h2>
          <p className="text-stone-400 max-w-2xl mx-auto text-lg">
            Most land listings show you acreage and price. We dig into the details 
            that actually affect your hunting and your investment.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-8">
          {huntingFeatures.map((feature, index) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 20 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, delay: index * 0.15 }}
            >
              <Card className={`h-full bg-stone-800/50 ${feature.borderColor} border hover:border-emerald-500 transition-all duration-300`}>
                <CardContent className="p-6">
                  <div className={`w-14 h-14 ${feature.bgColor} rounded-xl flex items-center justify-center mb-5 border ${feature.borderColor}`}>
                    <feature.icon className={`w-7 h-7 ${feature.color}`} />
                  </div>
                  <h3 className="text-xl font-bold text-white mb-1">
                    {feature.title}
                  </h3>
                  <p className="text-sm text-emerald-400 mb-4 italic">{feature.subtitle}</p>
                  <p className="text-stone-300 leading-relaxed">{feature.description}</p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeaturesSection() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });

  const features = [
    {
      icon: MapPin,
      title: "Type Any Address",
      description:
        "Just punch in the address. We'll grab the parcel boundaries, acreage, and owner info from county records.",
    },
    {
      icon: Layers,
      title: "8 Data Layers Deep",
      description:
        "Flood zones, topography, soil types, wetlands — plus our exclusive hunting intel. All in one place.",
    },
    {
      icon: FileText,
      title: "Take It to the Bank",
      description:
        "Professional PDF you can share with lenders, partners, or your hunting buddies. Looks sharp.",
    },
    {
      icon: Shield,
      title: "Government Sources",
      description:
        "FEMA, USGS, USDA, Missouri Conservation. Official data, not guesswork.",
    },
  ];

  return (
    <section ref={ref} className="py-20 bg-stone-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <h2 className="text-3xl md:text-4xl font-bold text-stone-800 mb-4">
            How It Works (It's Pretty Simple)
          </h2>
          <p className="text-stone-600 max-w-2xl mx-auto text-lg">
            We've done the hard work of pulling data from a dozen different sources. 
            You just type in an address and get the full picture.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((feature, index) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 20 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, delay: index * 0.1 }}
            >
              <Card className="h-full hover:shadow-xl transition-all duration-300 bg-white border-stone-200 hover:border-emerald-400">
                <CardContent className="p-6">
                  <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center mb-4">
                    <feature.icon className="w-6 h-6 text-emerald-700" />
                  </div>
                  <h3 className="text-lg font-bold text-stone-800 mb-2">
                    {feature.title}
                  </h3>
                  <p className="text-stone-600">{feature.description}</p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function MapLayersSection() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });

  // Custom layer descriptions with folksy language
  const layerDescriptions: Record<string, string> = {
    "flood-zones": "Will your intercept point be underwater come spring?",
    "topography": "Find those ridges and hollows deer love",
    "wetlands": "Protected areas you need to know about",
    "soil-types": "Can you plant food plots? We'll tell ya",
    "zoning": "What you can and can't build out there",
    "tax-assessment": "What the county thinks it's worth",
    "insurance-risk": "Heads up on potential insurance costs",
    "school-district": "Good to know if the family's coming along",
  };

  return (
    <section ref={ref} className="py-20 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <h2 className="text-3xl md:text-4xl font-bold text-stone-800 mb-4">
            What's in Your Report
          </h2>
          <p className="text-stone-600 max-w-2xl mx-auto text-lg">
            Every report comes loaded with these data layers. 
            No extra charges, no upsells — you get the whole enchilada.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
          {MAP_LAYERS.map((layer, index) => (
            <motion.div
              key={layer.id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={isInView ? { opacity: 1, scale: 1 } : {}}
              transition={{ duration: 0.4, delay: index * 0.05 }}
              className="bg-stone-50 rounded-xl p-5 hover:shadow-lg hover:bg-white transition-all duration-300 border border-stone-100"
            >
              <div className="flex items-start gap-3">
                <div
                  className="w-4 h-4 rounded-full mt-1 flex-shrink-0 shadow-sm"
                  style={{ backgroundColor: layer.color, boxShadow: `0 0 0 2px white, 0 0 0 4px ${layer.color}40` }}
                />
                <div>
                  <h4 className="font-bold text-stone-800 mb-1">
                    {layer.displayName}
                  </h4>
                  <p className="text-sm text-stone-500 italic">
                    {layerDescriptions[layer.id] || layer.dataSource}
                  </p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        <motion.div 
          initial={{ opacity: 0 }}
          animate={isInView ? { opacity: 1 } : {}}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="text-center mt-10 p-6 bg-emerald-50 rounded-2xl border border-emerald-200"
        >
          <p className="text-emerald-800 font-medium mb-2">
            🎯 Plus our exclusive hunting intel: CWD status, harvest pressure & drought conditions
          </p>
          <p className="text-emerald-600 text-sm">
            Data you won't find on any other land report
          </p>
        </motion.div>
      </div>
    </section>
  );
}

function HowItWorksSection() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });

  const steps = [
    {
      number: "1",
      title: "Punch in the address",
      description:
        "Type any property address and we'll find it. Works for rural routes, county roads, even \"that place off Highway 5.\"",
      emoji: "📍",
    },
    {
      number: "2",
      title: "We do the digging",
      description:
        "Our system pulls from FEMA, USDA, Missouri Conservation, county assessors — all the sources you'd spend days researching.",
      emoji: "🔍",
    },
    {
      number: "3",
      title: "Get your report",
      description:
        "Download a professional PDF you can actually understand. Plain English, clear maps, no jargon.",
      emoji: "📄",
    },
  ];

  return (
    <section ref={ref} className="py-20 bg-stone-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-14"
        >
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
            Three Steps. That's It.
          </h2>
          <p className="text-stone-400 max-w-2xl mx-auto text-lg">
            No account required. No salespeople calling you. 
            Just good information when you need it.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-8">
          {steps.map((step, index) => (
            <motion.div
              key={step.number}
              initial={{ opacity: 0, y: 20 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, delay: index * 0.2 }}
              className="text-center"
            >
              <div className="w-20 h-20 bg-stone-700 rounded-2xl flex items-center justify-center mx-auto mb-5 text-4xl shadow-lg">
                {step.emoji}
              </div>
              <h3 className="text-xl font-bold text-white mb-3">
                {step.title}
              </h3>
              <p className="text-stone-400 leading-relaxed">{step.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CTASection() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });

  return (
    <section ref={ref} className="py-20 bg-gradient-to-br from-emerald-700 to-emerald-900">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
        >
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
            Got a property on your mind?
          </h2>
          <p className="text-emerald-100 text-xl mb-3">
            Let's find out what you're really looking at.
          </p>

          <Link href="/map">
            <Button
              size="lg"
              className="bg-amber-500 hover:bg-amber-400 text-stone-900 shadow-xl px-10 text-lg font-semibold"
            >
              <MapPin className="w-5 h-5 mr-2" />
              Look Up a Property
            </Button>
          </Link>

          <div className="mt-10 pt-8 border-t border-emerald-600">
            <p className="text-emerald-200 text-sm mb-4">Questions? Just holler.</p>
            <p className="text-white font-medium">Clark @ Terra Firma Partners</p>
            <p className="text-emerald-300 text-sm">Your neighbor in the land business</p>
          </div>
        </motion.div>
      </div>
    </section>
  );
}