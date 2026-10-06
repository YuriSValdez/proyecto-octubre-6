-- ============================================================
--  DATOS DE EJEMPLO (opcional) para probar reportes y el panel.
--  Ejecutar UNA sola vez, después de schema.sql
-- ============================================================
PRAGMA foreign_keys = ON;

INSERT INTO Clientes (nombre_cliente, telefono_cliente) VALUES
    ('Marta Diaz',     '67873434'),
    ('Luis Carranza',  '65652334'),
    ('Ana Quispe',     '71234567');

INSERT INTO Pedidos (num_pedido, id_cliente, fecha_pedido, hora_pedido, tipo_entrega, direccion, metodo_pago, estado) VALUES
    (1, 1, date('now','localtime','-2 day'), '13:12', 'Local',    NULL,               'Efectivo',      'Entregado'),
    (2, 2, date('now','localtime','-1 day'), '15:02', 'Recoger',  NULL,               'QR',            'Entregado'),
    (3, 3, date('now','localtime'),          '12:40', 'Delivery', 'Av. Cívica #123',  'Transferencia', 'En preparación'),
    (4, 1, date('now','localtime'),          '13:05', 'Local',    NULL,               'Efectivo',      'Pendiente');

-- Cada línea toma el precio actual desde la tabla Productos
INSERT INTO Detalle_Pedido (num_pedido, id_producto, cantidad, precio_unitario, subtotal)
SELECT v.num_pedido, p.id_producto, v.cantidad, p.precio, p.precio * v.cantidad
FROM (SELECT 1 AS num_pedido, 3 AS id_producto, 1 AS cantidad UNION ALL
      SELECT 1, 10, 2 UNION ALL
      SELECT 2, 5, 2 UNION ALL
      SELECT 2, 12, 1 UNION ALL
      SELECT 3, 7, 2 UNION ALL
      SELECT 3, 6, 1 UNION ALL
      SELECT 4, 1, 1 UNION ALL
      SELECT 4, 9, 1) v
JOIN Productos p ON p.id_producto = v.id_producto;

-- El total de cada pedido = suma de sus subtotales
UPDATE Pedidos
SET total = (SELECT SUM(subtotal) FROM Detalle_Pedido d WHERE d.num_pedido = Pedidos.num_pedido);
