import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <title>Masumi | Admin Interface</title>
        <link rel="icon" href="/logo.png" />
        <meta property="og:title" content="Masumi | Admin Interface" />
        <meta property="og:description" content="Masumi" />
        <meta property="og:image" content="/logo.png" />
        <meta property="og:url" content="https://masumi.network" />
      </Head>
      <body className="antialiased">
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
