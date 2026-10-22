import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Only /interview/setup and /presentation/setup require auth — exact paths only.
const SETUP_PATHS = ['/interview/setup', '/presentation/setup', '/profile'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isAdmin = pathname.startsWith('/admin');
  const isSetup = SETUP_PATHS.includes(pathname);

  if (!isAdmin && !isSetup) {
    return NextResponse.next();
  }

  const response = NextResponse.next();
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

  // getUser() verifies the token server-side via GoTrue (not just the local cookie).
  const { data: { user } } = await supabase.auth.getUser();

  if (isSetup) {
    if (!user) {
      const next = encodeURIComponent(pathname);
      return NextResponse.redirect(new URL(`/auth/login?next=${next}`, request.url));
    }
    return response;
  }

  // Admin branch — behavior unchanged from before.
  if (!user) {
    return NextResponse.redirect(new URL('/auth/login', request.url));
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (!profile || profile.role !== 'admin') {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return response;
}

export const config = {
  matcher: ['/admin/:path*', '/interview/setup', '/presentation/setup', '/profile'],
};
