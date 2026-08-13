import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabase/client";

export type Role = "OWNER" | "ADMIN" | "SUPERVISOR" | "AGENT";

export type Membership = {
  organization_id: string;
  role: Role;
  organizations: { id: string; name: string; slug: string | null } | null;
};

type AuthState = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  membership: Membership | null;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState>({
  user: null,
  session: null,
  loading: true,
  membership: null,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [membership, setMembership] = useState<Membership | null>(null);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setLoading(false);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session?.user) {
      setMembership(null);
      return;
    }
    supabase
      .from("memberships")
      .select("organization_id, role, organizations(id, name, slug)")
      .eq("user_id", session.user.id)
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setMembership((data as unknown as Membership) ?? null));
  }, [session?.user?.id]);

  return (
    <AuthContext.Provider
      value={{
        user: session?.user ?? null,
        session,
        loading,
        membership,
        signOut: async () => {
          await supabase.auth.signOut();
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
