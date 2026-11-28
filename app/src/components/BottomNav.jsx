// Phone: the bottom tab bar — Read, Library, Listen, Practice, More. Library and Listen open their
// screens; Practice and More open the menu drawer (at Practice, or at the top) through the
// 'tachyread-open-menu' event MenuBar listens for; Read goes back to the book (or the start screen).
import { t } from '../i18n.js';

export default function BottomNav({ dialog, onRead, onOpen, onMenu }) {
  const kind = dialog?.kind;
  const items = [
    { id: 'read', icon: '📖', label: t('Reader'), on: !kind, fn: onRead },
    { id: 'library', icon: '🗺️', label: t('Library'), on: kind === 'literary-journey', fn: () => onOpen('literary-journey') },
    { id: 'listen', icon: '🎧', label: t('Listen'), on: kind === 'listen-player', fn: () => onOpen('listen-player') },
    { id: 'practice', icon: '🏋️', label: t('Practice'), fn: () => onMenu('practice') },
    { id: 'more', icon: '☰', label: t('More'), fn: () => onMenu(null) },
  ];
  return (
    <nav className="bottom-nav" aria-label={t('Main')}>
      {items.map((it) => (
        <button key={it.id} className={it.on ? 'on' : ''} aria-current={it.on ? 'page' : undefined} onClick={it.fn}>
          <span aria-hidden="true">{it.icon}</span>
          <span className="bottom-nav-label">{it.label}</span>
        </button>
      ))}
    </nav>
  );
}
