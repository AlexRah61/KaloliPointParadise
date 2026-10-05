// Permanent redirect from www to the canonical apex host, keeping path and query (UTM/gclid survive).
export default {
  fetch(request) {
    const url = new URL(request.url);
    url.protocol = 'https:';
    url.hostname = 'kalolipointparadisehawaii.com';
    url.port = '';
    return Response.redirect(url.toString(), 301);
  },
};
