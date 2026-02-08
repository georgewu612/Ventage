"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
    TrendingUp,
    DollarSign,
    Users,
    MessageSquare,
    BarChart3,
    Menu,
    X
} from "lucide-react";
import { useState } from "react";

const navItems = [
    {
        name: "市场信号",
        href: "/dashboard",
        icon: TrendingUp,
    },
    {
        name: "期权异动",
        href: "/dashboard/options",
        icon: DollarSign,
    },
    {
        name: "内部交易",
        href: "/dashboard/insider",
        icon: Users,
    },
    {
        name: "市场情绪",
        href: "/dashboard/sentiment",
        icon: MessageSquare,
    },
];

export function Sidebar() {
    const pathname = usePathname();
    const [isOpen, setIsOpen] = useState(false);

    return (
        <>
            {/* Mobile Menu Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="lg:hidden fixed top-4 left-4 z-50 p-2 rounded-lg bg-white/10 backdrop-blur text-white"
            >
                {isOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>

            {/* Sidebar */}
            <aside
                className={`
          fixed top-0 left-0 h-full w-64 bg-slate-900/95 backdrop-blur-xl border-r border-white/10 
          transform transition-transform duration-300 z-40
          ${isOpen ? "translate-x-0" : "-translate-x-full"}
          lg:translate-x-0
        `}
            >
                {/* Logo */}
                <div className="p-6 border-b border-white/10">
                    <div className="flex items-center gap-3">
                        <BarChart3 className="h-8 w-8 text-purple-400" />
                        <div>
                            <h1 className="text-xl font-bold text-white">Ventage</h1>
                            <p className="text-xs text-gray-400">AI Fintech</p>
                        </div>
                    </div>
                </div>

                {/* Navigation */}
                <nav className="p-4 space-y-2">
                    {navItems.map((item) => {
                        const Icon = item.icon;
                        const isActive = pathname === item.href;

                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                onClick={() => setIsOpen(false)}
                                className={`
                  flex items-center gap-3 px-4 py-3 rounded-lg transition-all
                  ${isActive
                                        ? "bg-purple-500/20 text-purple-300 font-medium"
                                        : "text-gray-400 hover:bg-white/5 hover:text-white"
                                    }
                `}
                            >
                                <Icon className="h-5 w-5" />
                                <span>{item.name}</span>
                            </Link>
                        );
                    })}
                </nav>

                {/* Footer */}
                <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-white/10">
                    <div className="text-xs text-gray-500 text-center">
                        © 2026 Ventage
                    </div>
                </div>
            </aside>

            {/* Mobile Overlay */}
            {isOpen && (
                <div
                    className="lg:hidden fixed inset-0 bg-black/50 z-30"
                    onClick={() => setIsOpen(false)}
                />
            )}
        </>
    );
}
