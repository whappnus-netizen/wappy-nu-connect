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
  membershipLoading: boolean;
  membershipError: string | null;
  refreshMembership: () => Promise<Membership | null>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState>({
  user: null,
  session: null,
  loading: true,
  membership: null,
  membershipLoading: true,
  membershipError: null,
  refreshMembership: async () => null,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [membershipLoading, setMembershipLoading] = useState(true);
  const [membershipError, setMembershipError] = useState<string | null>(null);

  async function refreshMembership(): Promise<Membership | null> {
    const userId = session?.user?.id;
    if (!userId) {
      setMembership(null);
      setMembershipLoading(false);
      return null;
    }

    setMembershipLoading(true);
    setMembershipError(null);
    const { data, error } = await supabase
      .from("memberships")
      .select("organization_id, role, organizations(id, name, slug)")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();

    setMembershipLoading(false);
    if (error) {
      console.error("[Wappy Nus] Falha ao carregar membership", error);
      setMembership(null);
      setMembershipError(error.message);
      return null;
    }

    const nextMembership = (data as unknown as Membership) ?? null;
    setMembership(nextMembership);
    return nextMembership;
  }

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
      setMembershipLoading(false);
      setMembershipError(null);
      return;
    }
    void refreshMembership();
  }, [session?.user?.id]);

  return (
    <AuthContext.Provider
      value={{
        user: session?.user ?? null,
        session,
        loading,
        membership,
        membershipLoading,
        membershipError,
        refreshMembership,
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
