const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const KycStatus = sequelize.define('KycStatus', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    walletAddress: {
      type: DataTypes.STRING,
      allowNull: false
    },
    fullName: {
      type: DataTypes.STRING,
      allowNull: true
    },
    dateOfBirth: {
      type: DataTypes.DATEONLY,
      allowNull: true
    },
    address: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    documentHash: {
      type: DataTypes.STRING,
      allowNull: true
    },
    status: {
      type: DataTypes.ENUM('None', 'Pending', 'Verified', 'Rejected'),
      defaultValue: 'None'
    },
    shieldedIntent: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    submittedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    verifiedAt: {
      type: DataTypes.DATE,
      allowNull: true
    }
  }, {
    tableName: 'kyc_statuses',
    indexes: [
      { fields: ['userId'] },
      { fields: ['walletAddress'] },
      { fields: ['status'] }
    ]
  });

  return KycStatus;
};
