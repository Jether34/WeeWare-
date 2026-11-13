import json
from pathlib import Path
from sklearn.metrics import confusion_matrix, classification_report, accuracy_score, balanced_accuracy_score

root = Path(__file__).resolve().parents[1]
experiment = root / 'ml-service/model_experiments/35a8782a52494c5ea97dc3f086018427/experiment.json'
data = json.loads(experiment.read_text(encoding='utf-8'))['validation']
labels = ['Low', 'Medium', 'High']
def classify(value):
    return 'Low' if value < 33 else ('Medium' if value < 66 else 'High')
actual = [classify(value) for value in data['observed']]
predicted = [classify(value) for value in data['predictions']]
matrix = confusion_matrix(actual, predicted, labels=labels)
output = root / 'reports/model_validation'
output.mkdir(parents=True, exist_ok=True)
report = {
    'experiment': data['method'], 'source': str(experiment.relative_to(root)),
    'classes': labels, 'thresholds_percent': {'low': '<33', 'medium': '33 to <66', 'high': '>=66'},
    'matrix_rows_actual_columns_predicted': matrix.tolist(),
    'support': {name: int(sum(label == name for label in actual)) for name in labels},
    'accuracy': float(accuracy_score(actual, predicted)),
    'balanced_accuracy': float(balanced_accuracy_score(actual, predicted)),
    'classification_report': classification_report(actual, predicted, labels=labels, output_dict=True, zero_division=0),
    'note': 'Exploratory grouped leave-one-year-out predictions; class metrics are limited by the small, imbalanced and non-independent dataset.'
}
(output / 'confusion-matrix.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
csv = ['actual/predicted,' + ','.join(labels)]
csv.extend(name + ',' + ','.join(map(str, row)) for name, row in zip(labels, matrix.tolist()))
(output / 'confusion-matrix.csv').write_text('\n'.join(csv) + '\n', encoding='utf-8')
print(json.dumps({'matrix': matrix.tolist(), 'support': report['support'], 'accuracy': report['accuracy'], 'balanced_accuracy': report['balanced_accuracy']}))
