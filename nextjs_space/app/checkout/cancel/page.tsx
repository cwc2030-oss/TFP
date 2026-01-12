"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { XCircle, ArrowLeft, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function CheckoutCancelPage() {
  return (
    <div className="min-h-screen pt-16 bg-gradient-to-br from-stone-50 to-amber-50 flex items-center justify-center py-12 px-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md"
      >
        <Card className="shadow-xl text-center">
          <CardContent className="p-8">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
              className="w-20 h-20 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-6"
            >
              <XCircle className="w-10 h-10 text-amber-600" />
            </motion.div>

            <h1 className="text-2xl font-bold text-stone-800 mb-2">
              Payment Cancelled
            </h1>
            <p className="text-stone-600 mb-6">
              Your order was not completed. No charges have been made.
            </p>

            <div className="space-y-4">
              <Link href="/map" className="block">
                <Button className="w-full bg-emerald-700 hover:bg-emerald-800 text-white h-12">
                  <ArrowLeft className="w-5 h-5 mr-2" />
                  Return to Map
                </Button>
              </Link>

              <p className="text-sm text-stone-500">
                Having issues? Contact us at info@terrafirmapartners.com
              </p>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
