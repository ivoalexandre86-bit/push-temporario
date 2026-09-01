import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { PERMISSIONS, ROLE_LABELS } from '../utils/constants';

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Painel', icon: '📊' },
  { to: '/acoes', label: 'Ações', icon: '📋' },
  { to: '/projetos', label: 'Projetos', icon: '🗂️' },
  { to: '/horas', label: 'Horas', icon: '⏱️' },
  { to: '/relatorios', label: 'Relatórios', icon: '📈' },
  { to: '/auditoria', label: 'Auditoria', icon: '🛡️', permission: PERMISSIONS.AUDIT_VIEW },
  { to: '/admin/usuarios', label: 'Usuários', icon: '👤', permission: PERMISSIONS.USERS_MANAGE },
];

export default function Layout() {
  const { user, logout, hasPermission } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const items = NAV_ITEMS.filter((i) => !i.permission || hasPermission(i.permission));

  return (
    <div className="min-h-screen flex bg-[var(--color-bg)]">
      {/* Sidebar - desktop */}
      <aside className="hidden md:flex md:flex-col w-60 shrink-0 border-r border-[var(--color-border)] bg-white">
        <SidebarContent items={items} />
      </aside>

      {/* Sidebar - mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-64 bg-white shadow-xl flex flex-col">
            <SidebarContent items={items} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 bg-white border-b border-[var(--color-border)] px-4 md:px-6 h-14 flex items-center justify-between no-print">
          <div className="flex items-center gap-3">
            <button
              className="md:hidden p-2 -ml-2 text-gray-600"
              aria-label="Abrir menu"
              onClick={() => setMobileOpen(true)}
            >
              ☰
            </button>
            <span className="font-semibold text-gray-800 md:hidden">Gestão de Projetos</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <div className="text-right hidden sm:block">
              <div className="font-medium text-gray-800">{user?.name}</div>
              <div className="text-xs text-gray-500">{ROLE_LABELS[user?.role] || user?.role}</div>
            </div>
            <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-semibold" aria-hidden="true">
              {user?.name?.[0]?.toUpperCase() || '?'}
            </div>
            <button onClick={handleLogout} className="ml-1 px-3 py-1.5 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm">
              Sair
            </button>
          </div>
        </header>
        <main className="flex-1 min-w-0 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function SidebarContent({ items, onNavigate }) {
  return (
    <>
      <div className="h-14 flex items-center px-5 border-b border-[var(--color-border)]">
        <span className="font-bold text-gray-900 text-base leading-tight">Gestão de<br />Projetos</span>
      </div>
      <nav className="flex-1 py-3 px-2 space-y-1" aria-label="Navegação principal">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`
            }
          >
            <span aria-hidden="true">{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>
    </>
  );
}
