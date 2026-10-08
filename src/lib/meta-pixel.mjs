// Meta Pixel base code exactly as Meta publishes it, plus two of Meta's documented switches: autoConfig off (only
// PageView and the site's own Lead and Contact events are sent) and disablePushState (menu links that update the
// address with pushState are not new page views). The CSP allows this exact text by its SHA-256 hash.

/**
 * @param {string} id
 * @returns {string}
 */
export function metaPixelCode(id) {
  if (!/^\d{8,20}$/.test(id)) throw new Error(`Invalid Meta Pixel ID: ${id}`);
  return `
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq.disablePushState = true;
fbq('set', 'autoConfig', false, '${id}');
fbq('init', '${id}');
fbq('track', 'PageView');
`;
}

/**
 * CSP source expression for an inline script's exact text.
 * @param {string} text
 * @returns {Promise<string>}
 */
export async function cspHash(text) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return `'sha256-${btoa(String.fromCharCode(...digest))}'`;
}
