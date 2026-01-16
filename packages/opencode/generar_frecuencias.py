import random
import matplotlib.pyplot as plt
from collections import Counter


def generar_y_graficar_frecuencias(n):
    # Generar n números aleatorios entre 0 y 100
    numeros = [random.randint(0, 100) for _ in range(n)]

    # Contar frecuencias
    frecuencias = Counter(numeros)

    # Crear gráfico
    plt.figure(figsize=(12, 6))

    # Gráfico de barras de frecuencias
    plt.bar(
        frecuencias.keys(),
        frecuencias.values(),
        alpha=0.7,
        color="skyblue",
        edgecolor="navy",
    )

    # Configurar gráfico
    plt.title(f"Frecuencia de {n} números aleatorios entre 0 y 100", fontsize=14)
    plt.xlabel("Número", fontsize=12)
    plt.ylabel("Frecuencia", fontsize=12)
    plt.grid(True, alpha=0.3)

    # Mostrar estadísticas
    plt.text(
        0.02,
        0.98,
        f"Total: {n} números\nRango: 0-100\nPromedio: {sum(numeros) / len(numeros):.2f}",
        transform=plt.gca().transAxes,
        verticalalignment="top",
        bbox=dict(boxstyle="round", facecolor="wheat", alpha=0.8),
    )

    plt.tight_layout()
    plt.show()

    return numeros, frecuencias


# Ejemplo de uso
if __name__ == "__main__":
    n = 1000  # Cantidad de números a generar
    numeros, frecuencias = generar_y_graficar_frecuencias(n)

    print(f"Se generaron {n} números aleatorios")
    print(
        f"El número más frecuente fue: {max(frecuencias, key=frecuencias.get)} (aparece {frecuencias[max(frecuencias, key=frecuencias.get)]} veces)"
    )
    print(f"Promedio: {sum(numeros) / len(numeros):.2f}")
