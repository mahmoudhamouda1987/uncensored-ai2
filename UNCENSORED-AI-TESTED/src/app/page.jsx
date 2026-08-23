"use client";
import { useState, useRef, useEffect } from "react";
import { Turnstile } from '@marsidev/react-turnstile';
import Workbench from "@/components/workbench/Workbench";

const SESSION_VERIFIED_KEY = "gptoss_turnstile_verified";

export default function Home() {
  const [turnstileToken, setTurnstileToken] = useState("");
  const turnstileRef = useRef(null);
  const isSessionVerified = useRef(false);
  const [, setForce] = useState(0);

  useEffect(() => {
    if (typeof window !== "undefined") {
      let storedUserId = localStorage.getItem("userId");
      if (!storedUserId) {
        storedUserId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
        localStorage.setItem("userId", storedUserId);
      }
      isSessionVerified.current = sessionStorage.getItem(SESSION_VERIFIED_KEY) === "1";
    }
    if (typeof window !== 'undefined') {
      window.__setTurnstileToken = (token) => {
        setTurnstileToken(token);
        setForce((n) => n + 1);
      };
    }
  }, []);

  const needsVerification = process.env.NODE_ENV === "production" && !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const isVerified = !needsVerification || !!turnstileToken || isSessionVerified.current;

  return (
    <Workbench
      needsVerification={needsVerification}
      isVerified={isVerified}
      turnstileToken={turnstileToken}
      turnstileRef={turnstileRef}
    />
  );
}
