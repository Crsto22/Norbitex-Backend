export const defaultCompanyColors = [
  { nombre: 'Negro', nombreKey: 'negro', hex: '#000000' },
  { nombre: 'Blanco', nombreKey: 'blanco', hex: '#FFFFFF' },
  { nombre: 'Gris', nombreKey: 'gris', hex: '#6B7280' },
  { nombre: 'Rojo', nombreKey: 'rojo', hex: '#DC2626' },
  { nombre: 'Azul marino', nombreKey: 'azul marino', hex: '#1E3A5F' },
  { nombre: 'Azul', nombreKey: 'azul', hex: '#2563EB' },
  { nombre: 'Celeste', nombreKey: 'celeste', hex: '#38BDF8' },
  { nombre: 'Verde', nombreKey: 'verde', hex: '#16A34A' },
  { nombre: 'Rosado', nombreKey: 'rosado', hex: '#EC4899' },
  { nombre: 'Beige', nombreKey: 'beige', hex: '#D2B48C' },
  { nombre: 'Marrón', nombreKey: 'marrón', hex: '#8B4513' },
  { nombre: 'Morado', nombreKey: 'morado', hex: '#7C3AED' },
  { nombre: 'Naranja', nombreKey: 'naranja', hex: '#F97316' },
  { nombre: 'Amarillo', nombreKey: 'amarillo', hex: '#EAB308' },
  { nombre: 'Coral', nombreKey: 'coral', hex: '#FF6B6B' },
  { nombre: 'Turquesa', nombreKey: 'turquesa', hex: '#14B8A6' },
  { nombre: 'Vino', nombreKey: 'vino', hex: '#722F37' },
  { nombre: 'Oliva', nombreKey: 'oliva', hex: '#808000' },
  { nombre: 'Crema', nombreKey: 'crema', hex: '#FFFDD0' },
  { nombre: 'Lila', nombreKey: 'lila', hex: '#C4B5FD' },
] as const;

export const defaultApparelSizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL'].map(
  (nombre) => ({ nombre, nombreKey: nombre.toLowerCase() }),
);

export const defaultFootwearSizes = Array.from({ length: 25 }, (_, index) =>
  String(index + 24),
).map((nombre) => ({ nombre, nombreKey: nombre }));

export const companyCatalogProfiles = [
  'ropa',
  'calzado',
  'ropa_calzado',
  'otros',
] as const;

export type CompanyCatalogProfile = (typeof companyCatalogProfiles)[number];

type CompanyCatalogs = {
  colors: ReadonlyArray<(typeof defaultCompanyColors)[number]>;
  sizes: ReadonlyArray<{ nombre: string; nombreKey: string }>;
};

export function getDefaultCompanyCatalogs(
  profile: CompanyCatalogProfile,
): CompanyCatalogs {
  if (profile === 'otros') return { colors: [], sizes: [] };

  return {
    colors: defaultCompanyColors,
    sizes:
      profile === 'ropa'
        ? defaultApparelSizes
        : profile === 'calzado'
          ? defaultFootwearSizes
          : [...defaultApparelSizes, ...defaultFootwearSizes],
  };
}
