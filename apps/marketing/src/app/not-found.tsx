import Link from 'next/link';
import { Footer } from '@/components/layout/Footer';
import { Navbar } from '@/components/layout/Navbar';
import { buttonVariants } from '@/components/ui/button';

export const metadata = { title: 'Page not found', robots: { index: false } };

export default function NotFound() {
  return (
    <>
      <Navbar />
      <main
        id="main"
        className="mx-auto flex min-h-[50vh] max-w-xl flex-col items-center justify-center px-4 py-24 text-center"
      >
        <p className="text-sm font-semibold text-link">404</p>
        <h1 className="mt-2 text-4xl font-bold">We could not find that page</h1>
        <p className="mt-3 text-muted">
          It may have moved. Try the home page or one of our main sections.
        </p>
        <Link href="/" className={`${buttonVariants()} mt-8`}>
          Back to home
        </Link>
      </main>
      <Footer />
    </>
  );
}
