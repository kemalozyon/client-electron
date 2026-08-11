/**
 * Hata / bilgi şeridi.
 *
 * KURAL: buraya sunucunun kendi `detail` metni geçilir, kendi uydurduğumuz bir
 * kopya değil. Özellikle 401: POST /auth/login için "parola yanlış" demek,
 * diğer bütün rotalar için "token öldü" demek. Tek bir sabit "oturumunuz sona
 * erdi" metni, parolayı yanlış yazan kullanıcıya hiç var olmamış bir oturumdan
 * bahsediyordu. (SPEC_FRONT §4.3)
 */
export function ErrorNote({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <p
      role="alert"
      className="rounded-lg border border-state-down/40 bg-state-down/10 px-3 py-2 text-sm text-state-down shadow-sm"
    >
      {children}
    </p>
  )
}

export function InfoNote({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <p className="rounded-lg border border-state-ok/40 bg-state-ok/10 px-3 py-2 text-sm text-state-ok shadow-sm">
      {children}
    </p>
  )
}
