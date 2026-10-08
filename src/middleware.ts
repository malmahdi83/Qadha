import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  const response = NextResponse.next();

  // Only protect /admin
  if (!request.nextUrl.pathname.startsWith('/admin')) {
    return response;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL('/auth/login', request.url));
  }

  // Role check: fetch profile and verify admin
  const { data: profile, error: profileError } = await supabase // DIAGNOSTIC
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  // DIAGNOSTIC: log safe values only — no JWT, tokens, cookies, or keys
  console.log('[ADMIN_DIAG]', JSON.stringify({
    pathname: request.nextUrl.pathname,
    hasUser: !!user,
    userEmail: user.email ?? null,
    supabaseHost: new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname,
    profileExists: profile !== null,
    profileRole: profile?.role ?? null,
    profileErrorCode: profileError?.code ?? null,
    profileErrorMessage: profileError?.message ?? null,
  }));

  if (!profile || profile.role !== 'admin') {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return response;
}

export const config = {
  matcher: ['/admin/:path*'],
};
