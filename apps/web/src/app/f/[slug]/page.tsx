import type { Metadata } from "next";
import Script from "next/script";
import { headers } from "next/headers";

import { FillForm } from "@/fill/fill-form";
import { openLink } from "@/server/publish/queries";
import { clientIp, hit } from "@/server/publish/rate-limit";
import { turnstileSiteKey } from "@/server/publish/turnstile";

/**
 * The public fill page.
 *
 * An untrusted surface (architecture rule 6): reachable by anyone with the URL,
 * never indexed, rate limited, and handed only the version's document — no
 * owner, no draft, no other versions, nothing about the workspace.
 */

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const lookup = await openLink(slug);

  return {
    title: lookup.ok ? lookup.link.title : "Form",
    // A link handed to specific people has no business in a search index, and
    // the slug is the access control.
    robots: { index: false, follow: false },
  };
}

export default async function FillPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const token = typeof query.t === "string" ? query.t : undefined;

  // Guards against somebody walking the slug space from one address. Generous,
  // because a real person reloading a form is not an attack.
  const ip = clientIp(await headers());
  const limit = await hit("view", ip);
  if (!limit.ok) {
    return (
      <Closed
        heading="Too many requests"
        body="Please wait a little while and try again."
      />
    );
  }

  const lookup = await openLink(slug, token);

  if (!lookup.ok) {
    if (lookup.reason === "needs-token" || lookup.reason === "bad-token") {
      return (
        <Closed
          heading="This link needs a code"
          body="The link you followed is incomplete. Ask whoever sent it for the full address."
        />
      );
    }

    // Everything else — never existed, revoked, expired, used up — gets one
    // message. Distinguishing them would tell a stranger which slugs are real.
    return (
      <Closed
        heading="This form isn't available"
        body="The link may have expired or been withdrawn. Ask whoever sent it to you."
      />
    );
  }

  const { link } = lookup;
  const siteKey = turnstileSiteKey();

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#f1f5f9",
        padding: "24px 16px 64px",
      }}
    >
      {siteKey && (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js"
          strategy="afterInteractive"
        />
      )}

      <div style={{ maxWidth: 794, margin: "0 auto" }}>
        <h1
          style={{
            fontSize: 20,
            fontWeight: 600,
            margin: "0 0 16px",
            color: "#0f172a",
          }}
        >
          {link.title}
        </h1>

        <FillForm
          slug={slug}
          document={link.document}
          version={link.version}
          token={token}
          turnstileSiteKey={siteKey}
        />
      </div>
    </main>
  );
}

function Closed({ heading, body }: { heading: string; body: string }) {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "#f1f5f9",
        padding: 24,
      }}
    >
      <div
        style={{
          maxWidth: 440,
          textAlign: "center",
          background: "#ffffff",
          border: "1px solid #e2e8f0",
          borderRadius: 12,
          padding: 32,
        }}
      >
        <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>{heading}</h1>
        <p style={{ margin: 0, color: "#475569", lineHeight: 1.5 }}>{body}</p>
      </div>
    </main>
  );
}
