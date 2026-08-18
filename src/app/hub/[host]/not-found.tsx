// The hub's own 404.
//
// It says nothing about Mission Control, names no client, and offers no link back into the
// app. It answers for two different situations that must look identical from outside: a
// slug that does not exist on a real client's hub, and a hostname somebody pointed at us
// who is not a client at all.

export default function HubNotFound() {
  return (
    <div className="hub-root">
      <div className="hub-wrap">
        <h1>Page not found</h1>
        <p className="hub-lede">That address does not exist.</p>
      </div>
    </div>
  );
}
