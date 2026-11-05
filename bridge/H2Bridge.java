import java.io.*;
import java.nio.charset.StandardCharsets;
import java.sql.*;
import java.util.Base64;

/**
 * Minimal JDBC bridge. Config via env: H2_URL, H2_USER, H2_PASSWORD.
 * Protocol: one base64(SQL) per stdin line -> one JSON line on stdout.
 * First stdout line is the connect handshake: {"ok":true} or {"ok":false,"error":"..."}.
 */
public class H2Bridge {
    public static void main(String[] args) throws Exception {
        PrintStream out = new PrintStream(new FileOutputStream(FileDescriptor.out), true, "UTF-8");
        System.setOut(System.err); // keep stdout clean for the protocol

        Connection conn;
        try {
            Class.forName("org.h2.Driver");
            String user = System.getenv("H2_USER");
            String pass = System.getenv("H2_PASSWORD");
            conn = DriverManager.getConnection(
                System.getenv("H2_URL"), user == null ? "" : user, pass == null ? "" : pass);
        } catch (Throwable t) {
            out.println("{\"ok\":false,\"error\":" + str(t.getMessage() != null ? t.getMessage() : t.toString()) + "}");
            return;
        }
        out.println("{\"ok\":true}");

        BufferedReader in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        String line;
        while ((line = in.readLine()) != null) {
            line = line.trim();
            if (line.isEmpty()) continue;
            String sql = new String(Base64.getDecoder().decode(line), StandardCharsets.UTF_8);
            out.println(run(conn, sql));
        }
        try { conn.close(); } catch (Throwable ignored) { }
    }

    static String run(Connection c, String sql) {
        try (Statement st = c.createStatement()) {
            StringBuilder sb = new StringBuilder("{\"ok\":true,");
            if (st.execute(sql)) {
                try (ResultSet rs = st.getResultSet()) {
                    ResultSetMetaData md = rs.getMetaData();
                    int n = md.getColumnCount();
                    sb.append("\"cols\":[");
                    for (int i = 1; i <= n; i++) {
                        if (i > 1) sb.append(',');
                        sb.append(str(md.getColumnLabel(i)));
                    }
                    sb.append("],\"rows\":[");
                    boolean firstRow = true;
                    while (rs.next()) {
                        if (!firstRow) sb.append(',');
                        firstRow = false;
                        sb.append('[');
                        for (int i = 1; i <= n; i++) {
                            if (i > 1) sb.append(',');
                            Object o = rs.getObject(i);
                            if (o == null) sb.append("null");
                            else if (o instanceof Boolean) sb.append(o.toString());
                            else if (o instanceof Number) {
                                if (o instanceof Double && (((Double) o).isNaN() || ((Double) o).isInfinite())
                                    || o instanceof Float && (((Float) o).isNaN() || ((Float) o).isInfinite()))
                                    sb.append(str(o.toString()));
                                else if ((o instanceof Long && Math.abs((Long) o) > 9007199254740991L)
                                    || ((o instanceof java.math.BigDecimal || o instanceof java.math.BigInteger) && o.toString().length() > 15))
                                    sb.append(str(o.toString())); // too big for a JS number: keep exact as string
                                else sb.append(o.toString());
                            }
                            else sb.append(str(rs.getString(i)));
                        }
                        sb.append(']');
                    }
                    sb.append("]}");
                }
            } else {
                sb.append("\"updated\":").append(st.getUpdateCount()).append('}');
            }
            return sb.toString();
        } catch (Throwable t) {
            return "{\"ok\":false,\"error\":" + str(t.getMessage() != null ? t.getMessage() : t.toString()) + "}";
        }
    }

    static String str(String s) {
        if (s == null) return "null";
        StringBuilder b = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            switch (ch) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                default:
                    if (ch < 0x20) b.append(String.format("\\u%04x", (int) ch));
                    else b.append(ch);
            }
        }
        return b.append('"').toString();
    }
}
